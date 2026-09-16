// SPDX-License-Identifier: MIT
// main/ark-subscription.ts -- Native Ark (Volcengine) Coding/Agent Plan quota adapter
//
// 设计要点：
//   - 凭据来源：env(VOLC_ACCESS_KEY_ID/VOLC_SECRET_ACCESS_KEY) + safeStorage keystore
//   - endpoint: open.volcengineapi.com，POST GetAFPUsage / GetCodingPlanUsage（空 body）
//   - 60s lastSuccess 缓存，in-flight Promise 去重
//   - 鉴权/签名错误 → auth-error（对应上游 expired 语义）
import { resolveArkCredentials } from './subscription-keystore';
import { mapArkAfpResult, mapArkCodingPlanResult, type ArkSubscriptionSnapshot } from '../shared/ark-subscription';
import { ARK_CONTENT_TYPE, ARK_HOST, signArk } from './ark-signing';

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
    planLabel: null,
    limits: [],
    fetchedAt: null,
    stale: false,
    message,
  };
}

function staleFallback(message: string): ArkSubscriptionSnapshot {
  if (!lastSuccess) return unavailable('temporarily-unavailable', message);
  return { ...lastSuccess, stale: true, message };
}

async function fetchArk(action: 'GetAFPUsage' | 'GetCodingPlanUsage'): Promise<Record<string, unknown>> {
  const creds = resolveArkCredentials();
  if (!creds) throw new Error('not-configured');
  const region = creds.region || DEFAULT_REGION;
  const body = Buffer.alloc(0);
  const signed = signArk(creds.accessKeyId, creds.secretAccessKey, region, action, body);
  const query = action === 'GetAFPUsage' ? 'Action=GetAFPUsage' : 'Action=GetCodingPlanUsage';
  const url = `https://${ARK_HOST}/?${query}&Region=${encodeURIComponent(region)}&Version=2024-01-01`;
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
        throw new Error('auth-error:' + message);
      }
      throw new Error('http-error:' + code + ':' + message);
    }
    const result = (json['Result'] as Record<string, unknown> | undefined) ?? json;
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFreshArk(): Promise<ArkSubscriptionSnapshot> {
  const creds = resolveArkCredentials();
  if (!creds) return unavailable('not-configured', '未配置火山方舟 AccessKey/SecretKey（设置页「余量凭证」或环境变量 VOLC_ACCESS_KEY_ID/VOLC_SECRET_ACCESS_KEY）');

  try {
    const [afpResult, codingResult] = await Promise.all([fetchArk('GetAFPUsage'), fetchArk('GetCodingPlanUsage')]);
    const afp = mapArkAfpResult(afpResult);
    const coding = mapArkCodingPlanResult(codingResult);
    const limits = afp.limits.length >= coding.limits.length ? afp.limits : coding.limits;
    if (limits.length === 0) return staleFallback('火山方舟未返回可用的额度窗口');
    const planLabel = afp.planLabel ?? coding.planLabel ?? null;
    return {
      status: 'ready',
      planLabel,
      limits,
      fetchedAt: Math.floor(Date.now() / 1000),
      stale: false,
      message: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('not-configured')) return unavailable('not-configured', msg);
    if (msg.startsWith('auth-error')) return unavailable('auth-error', '火山方舟鉴权失败：' + msg.slice('auth-error:'.length));
    return staleFallback('火山方舟请求失败：' + msg);
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