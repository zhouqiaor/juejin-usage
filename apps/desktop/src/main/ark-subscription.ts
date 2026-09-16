// SPDX-License-Identifier: MIT
// main/ark-subscription.ts -- Native Ark (Volcengine) Coding/Agent Plan quota adapter
//
// 设计要点：
//   - 凭据来源：env(VOLC_ACCESS_KEY_ID/VOLC_SECRET_ACCESS_KEY) + safeStorage keystore
//   - endpoint: open.volcengineapi.com，POST GetAFPUsage / GetCodingPlanUsage（空 body）
//   - 60s lastSuccess 缓存，in-flight Promise 去重
//   - 鉴权/签名错误 → auth-error（对应上游 expired 语义）
import { resolveArkCredentials } from './subscription-keystore';
import { mapArkAfpResult, mapArkCodingPlanResult, mapArkTokenPacks, resolveArkPlanKind, type ArkSubscriptionSnapshot } from '../shared/ark-subscription';
import { friendlyArkError } from '../shared/ark-error';
import { ARK_CONTENT_TYPE, ARK_HOST, arkCanonicalQuery, signArk } from './ark-signing';

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const DEFAULT_REGION = 'cn-beijing';

let lastSuccess: ArkSubscriptionSnapshot | null = null;
let requestInFlight: Promise<ArkSubscriptionSnapshot> | null = null;

function unavailable(
  status: ArkSubscriptionSnapshot['status'],
  message: string,
): ArkSubscriptionSnapshot {
  return {
    status,
    planKind: null,
    planLabel: null,
    limits: [],
    tokenPacks: [],
    tokenPacksError: null,
    fetchedAt: null,
    stale: false,
    message,
  };
}

function staleFallback(message: string): ArkSubscriptionSnapshot {
  if (!lastSuccess) return unavailable('temporarily-unavailable', message);
  return { ...lastSuccess, stale: true, message };
}

type ArkAction = 'GetAFPUsage' | 'GetCodingPlanUsage' | 'ListModelChargeItems';

// 各 Action 附加的签名 query 参数（必须同时参与 V4 签名与实际 URL）
const ACTION_EXTRA_QUERY: Partial<Record<ArkAction, Record<string, string>>> = {
  // 默认页可能只回 20/50 条，显式拉满
  ListModelChargeItems: { PageSize: '100' },
};

async function fetchArk(action: ArkAction): Promise<Record<string, unknown>> {
  const creds = resolveArkCredentials();
  if (!creds) throw new Error('not-configured');
  const region = creds.region || DEFAULT_REGION;
  const body = Buffer.alloc(0);
  const extraQuery = ACTION_EXTRA_QUERY[action];
  const signed = signArk(creds.accessKeyId, creds.secretAccessKey, region, action, body, new Date(), extraQuery);
  const query = arkCanonicalQuery(action, region, extraQuery);
  const url = `https://${ARK_HOST}/?${query}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Date': signed.xDate,
        'X-Content-Sha256': signed.xContentSha256,
        'Content-Type': ARK_CONTENT_TYPE,
        Authorization: signed.authorization,
      },
      body,
      signal: controller.signal,
    });
    const json = (await res.json()) as Record<string, unknown>;
    const md = (json['ResponseMetadata'] as Record<string, unknown> | undefined) ?? {};
    const err = (md['Error'] as Record<string, unknown> | undefined) ?? (json['Error'] as Record<string, unknown> | undefined);
    if (err) {
      const code = String(err['Code'] ?? '');
      const message = String(err['Message'] ?? '');
      const lower = code.toLowerCase();
      if (lower.includes('auth') || lower.includes('signature') || lower.includes('denied') || lower.includes('credential') || lower.includes('token')) {
        // 带上 Code（如 SignatureDoesNotMatch），展示层 friendlyArkError 依赖错误码翻译
      throw new Error('auth-error:' + (code ? code + (message ? ': ' + message : '') : message));
      }
      throw new Error('http-error:' + code + ':' + message);
    }
    const result = (json['Result'] as Record<string, unknown> | undefined) ?? json;
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function flattenArkError(msg: string): string {
  if (msg.startsWith('auth-error:')) return friendlyArkError(msg.slice('auth-error:'.length) || '鉴权失败');
  const m = /^http-error:([^:]*):(.*)$/.exec(msg);
  if (m) return friendlyArkError(`${m[1]} ${m[2]}`.trim());
  return msg;
}

async function fetchFreshArk(): Promise<ArkSubscriptionSnapshot> {
  const creds = resolveArkCredentials();
  if (!creds) return unavailable('not-configured', '未配置火山方舟 AccessKey/SecretKey（设置页「余量凭证」或环境变量 VOLC_ACCESS_KEY_ID/VOLC_SECRET_ACCESS_KEY）');

  // Token 资源包为 best-effort 附加数据：并发发起，任何失败（含 AuthFailure/SSO-only）
  // 都只落到 tokenPacksError，不影响 coding/AFP 主快照
  const tokenPacksPromise = (async (): Promise<{ tokenPacks: ArkSubscriptionSnapshot['tokenPacks']; tokenPacksError: string | null }> => {
    try {
      const tokenResult = await fetchArk('ListModelChargeItems');
      return { tokenPacks: mapArkTokenPacks(tokenResult), tokenPacksError: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { tokenPacks: lastSuccess?.tokenPacks ?? [], tokenPacksError: flattenArkError(msg) };
    }
  })();

  try {
    // allSettled：Agent Plan 账号的 GetCodingPlanUsage 可能返回错误信封/reject，
    // 单路失败按「该路无数据」处理，不连坐 AFP 窗口与 tokenPacks；两路都失败才整体失败
    const [afpSettled, codingSettled] = await Promise.allSettled([
      fetchArk('GetAFPUsage'),
      fetchArk('GetCodingPlanUsage'),
    ]);
    const afpError =
      afpSettled.status === 'rejected'
        ? (afpSettled.reason instanceof Error ? afpSettled.reason.message : String(afpSettled.reason))
        : null;
    const codingError =
      codingSettled.status === 'rejected'
        ? (codingSettled.reason instanceof Error ? codingSettled.reason.message : String(codingSettled.reason))
        : null;
    if (afpError && codingError) {
      const errors = [afpError, codingError];
      const authMsg = errors.find((m) => m.startsWith('auth-error'));
      if (authMsg) {
        return unavailable('auth-error', '火山方舟鉴权失败：' + friendlyArkError(authMsg.slice('auth-error:'.length)));
      }
      // 无成功缓存时 staleFallback 自身回落为 unavailable('temporarily-unavailable')
      return staleFallback('火山方舟余量查询失败：' + errors.map(flattenArkError).join('；'));
    }
    const EMPTY_MAPPED = { planLabel: null, limits: [] };
    const afp = afpSettled.status === 'fulfilled' ? mapArkAfpResult(afpSettled.value) : EMPTY_MAPPED;
    const coding = codingSettled.status === 'fulfilled' ? mapArkCodingPlanResult(codingSettled.value) : EMPTY_MAPPED;
    const limits = afp.limits.length >= coding.limits.length ? afp.limits : coding.limits;
    const { tokenPacks, tokenPacksError } = await tokenPacksPromise;
    if (limits.length === 0) {
      const fallback = staleFallback('火山方舟未返回可用的额度窗口');
      return fallback.status === 'ready' ? { ...fallback, tokenPacks, tokenPacksError } : fallback;
    }
    const planLabel = afp.planLabel ?? coding.planLabel ?? null;
    // 与 limits 同一决胜规则（AFP 等长优先）；两接口皆空时为 null，但该分支已在上面走 staleFallback
    const planKind = resolveArkPlanKind(afp, coding);
    return {
      status: 'ready',
      planKind,
      planLabel,
      limits,
      tokenPacks,
      tokenPacksError,
      fetchedAt: Math.floor(Date.now() / 1000),
      stale: false,
      message: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('not-configured')) return unavailable('not-configured', msg);
    if (msg.startsWith('auth-error')) return unavailable('auth-error', '火山方舟鉴权失败：' + friendlyArkError(msg.slice('auth-error:'.length)));
    return staleFallback('火山方舟请求失败：' + flattenArkError(msg));
  }
}

export function readArkSubscription(options: { forceRefresh?: boolean } = {}): Promise<ArkSubscriptionSnapshot> {
  if (!options.forceRefresh && lastSuccess && Date.now() - (lastSuccess.fetchedAt ?? 0) * 1000 < CACHE_TTL_MS) {
    return Promise.resolve(lastSuccess);
  }
  if (requestInFlight && !options.forceRefresh) return requestInFlight;
  const p = (async () => {
    try {
      const snap = await fetchFreshArk();
      if (snap.status === 'ready') lastSuccess = snap;
      return snap;
    } finally {
      requestInFlight = null;
    }
  })();
  requestInFlight = p;
  return p;
}

export function _resetArkForTest(): void {
  lastSuccess = null;
  requestInFlight = null;
}