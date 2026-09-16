// SPDX-License-Identifier: MIT
// shared/ark-subscription.ts — Ark Coding Plan / Agent Plan 适配类型与纯映射
export interface ArkRateLimitWindow {
  id: 'five-hour' | 'weekly' | 'monthly';
  label: string;
  usedPercent: number;
  resetsAt: number | null;
}

export interface ArkTokenPack {
  model: string;
  displayName: string;
  /** 免费额度 = InferenceFreeUsage；资源包 = ResourcePackItems[type=FreeInference] */
  label: '免费额度' | '资源包';
  total: number;
  consumed: number;
  /** total - consumed；可能为负（过期降档），不做 clamp */
  remaining: number;
  /** consumed/total 百分比，clamp 到 0..100 供进度条使用 */
  usedPercent: number;
}

/**
 * 套餐种类：
 *   - 'agent'  = Agent Plan（GetAFPUsage 返回有效窗口，PlanType 如 pro）
 *   - 'coding' = Coding Plan（GetCodingPlanUsage 返回有效窗口）
 *   - null/缺省 = 未知或未订阅（错误态/stale 首次不可用）
 */
export type ArkPlanKind = 'coding' | 'agent';

export interface ArkSubscriptionSnapshot {
  status: 'ready' | 'not-configured' | 'auth-error' | 'custom-provider' | 'temporarily-unavailable';
  /** 套餐种类；main 成功路径必填。可选以兼容既有序列化/测试夹具，消费方按 null 处理 */
  planKind?: ArkPlanKind | null;
  planLabel: string | null;
  limits: ArkRateLimitWindow[];
  /** ListModelChargeItems best-effort 附加数据；失败不影响主快照 */
  tokenPacks: ArkTokenPack[];
  tokenPacksError: string | null;
  fetchedAt: number | null;
  stale: boolean;
  message: string | null;
}

const WINDOW_LABEL: Record<ArkRateLimitWindow['id'], string> = {
  'five-hour': '5h',
  weekly: '7d',
  monthly: '30d',
};

/**
 * 依据两个接口实际解析出的额度窗口判定套餐种类。
 * 依据：同一账号只订阅一种 Plan，另一接口返回空窗口集；
 * 保持与 main 既有的 limits 选取同一决胜规则——AFP 窗口数 >= Coding 时取 AFP（含等长），
 * 两个接口都无窗口返回 null（未知，走 stale/错误态）。
 */
export function resolveArkPlanKind(
  afp: { limits: readonly unknown[] },
  coding: { limits: readonly unknown[] },
): ArkPlanKind | null {
  if (afp.limits.length <= 0 && coding.limits.length <= 0) return null;
  return afp.limits.length >= coding.limits.length ? 'agent' : 'coding';
}

/** 卡片标题：planKind 动态决定，planLabel（Pro 档等）不拼入标题 */
export function arkPlanTitle(kind: ArkPlanKind | null | undefined): string {
  if (kind === 'agent') return '火山方舟 Agent Plan';
  if (kind === 'coding') return '火山方舟 Coding Plan';
  return '火山方舟';
}

/**
 * Agent Plan 官方档位白名单：GetAFPUsage 的 PlanType 为小写英文枚举
 * （Small ¥40/2万燃料值、Medium ¥200/10万、Large ¥500/25万、Max ¥1000/50万），
 * 显示官方英文名首字母大写，不翻译中文。
 */
const AGENT_PLAN_OFFICIAL_LABELS: Readonly<Record<string, string>> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  max: 'Max',
};

/**
 * 套餐档位显示名规范化（纯函数、不翻译、未知不臆造）：
 *  - kind='agent'：trim+小写命中白名单 small/medium/large/max → 官方英文名首字母大写；
 *    空值返回 null；未知值原样透传。
 *  - kind='coding'（及其它/未知 kind）：PlanType 若有值原样透传。
 */
export function normalizeArkPlanLabel(
  kind: ArkPlanKind | null | undefined,
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null;
  if (kind === 'agent') {
    if (!raw.trim()) return null;
    return AGENT_PLAN_OFFICIAL_LABELS[raw.trim().toLowerCase()] ?? raw;
  }
  return raw.trim() ? raw : null;
}

/**
 * 卡片副标题组合：「Agent Plan · Medium」/「Coding Plan · <raw>」；
 * 无档位名返回 null；kind 未知时只返回规范化后的档位名。
 */
export function arkPlanSubtitle(
  kind: ArkPlanKind | null | undefined,
  raw: string | null | undefined,
): string | null {
  const label = normalizeArkPlanLabel(kind, raw);
  if (!label) return null;
  if (kind === 'agent') return `Agent Plan · ${label}`;
  if (kind === 'coding') return `Coding Plan · ${label}`;
  return label;
}

function boundedPercent(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = v > 1 ? v : v * 100;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function parseReset(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function mapArkAfpResult(result: Record<string, unknown>): {
  planLabel: string | null;
  limits: ArkRateLimitWindow[];
} {
  const planLabel = typeof result['PlanType'] === 'string' ? (result['PlanType'] as string) : null;
  const limits: ArkRateLimitWindow[] = [];
  const buckets: Array<[string, ArkRateLimitWindow['id']]> = [
    ['AFPFiveHour', 'five-hour'],
    ['AFPWeekly', 'weekly'],
    ['AFPMonthly', 'monthly'],
  ];
  for (const [key, id] of buckets) {
    const win = asRecord(result[key]);
    if (!win) continue;
    const quota = Number(win['Quota'] ?? 0);
    const used = Number(win['Used'] ?? 0);
    if (!Number.isFinite(quota) || quota <= 0) continue;
    limits.push({
      id,
      label: WINDOW_LABEL[id],
      usedPercent: boundedPercent((used / quota) * 100),
      resetsAt: parseReset(win['ResetTime']),
    });
  }
  return { planLabel, limits };
}

const LEVEL_TO_ID: Record<string, ArkRateLimitWindow['id'] | undefined> = {
  session: 'five-hour', fivehour: 'five-hour', '5h': 'five-hour', five_hour: 'five-hour',
  weekly: 'weekly', week: 'weekly', '7d': 'weekly', weekly_limit: 'weekly', sevenday: 'weekly', seven_day: 'weekly',
  monthly: 'monthly', month: 'monthly',
};

export function mapArkCodingPlanResult(result: Record<string, unknown>): {
  planLabel: string | null;
  limits: ArkRateLimitWindow[];
} {
  const arr = (result['QuotaUsage'] ?? result['Usages'] ?? result['Details']) as unknown[] | undefined;
  if (!Array.isArray(arr)) return { planLabel: null, limits: [] };
  const limits: ArkRateLimitWindow[] = [];
  for (const itemRaw of arr) {
    const item = asRecord(itemRaw);
    if (!item) continue;
    const labelRaw = String(item['Level'] ?? item['Type'] ?? item['Period'] ?? item['Label'] ?? item['Window'] ?? '');
    const key = labelRaw.toLowerCase().replace(/[\s_-]+/g, '');
    const id = LEVEL_TO_ID[key] ?? LEVEL_TO_ID[labelRaw.toLowerCase()];
    if (!id) continue;
    const pct = item['Percent'] ?? item['UsedPercent'] ?? item['UsagePercent'];
    limits.push({
      id,
      label: WINDOW_LABEL[id],
      usedPercent: boundedPercent(pct),
      resetsAt: parseReset(item['ResetTime'] ?? item['ResetTimestamp']),
    });
  }
  return { planLabel: null, limits };
}

interface TokenPool {
  total: number;
  consumed: number;
}

function readTokenPool(v: unknown): TokenPool | null {
  const rec = asRecord(v);
  if (!rec) return null;
  const total = Number(rec['Total']);
  if (!Number.isFinite(total) || total <= 0) return null;
  const consumedRaw = Number(rec['Consumed']);
  const consumed = Number.isFinite(consumedRaw) ? consumedRaw : 0;
  return { total, consumed };
}

function toTokenPack(
  model: string,
  displayName: string,
  label: ArkTokenPack['label'],
  pool: TokenPool,
): ArkTokenPack {
  const remaining = pool.total - pool.consumed;
  return {
    model,
    displayName,
    label,
    total: pool.total,
    consumed: pool.consumed,
    remaining,
    usedPercent: Math.max(0, Math.min(100, Math.round((pool.consumed / pool.total) * 10000) / 100)),
  };
}

/**
 * 映射 ListModelChargeItems Result：
 *   - InferenceFreeUsage → 「免费额度」
 *   - ResourcePackItems[type=FreeInference] → 「资源包」（DataPermission 丢弃）
 *   - 同一模型两者 Total/Consumed 相等视为同一池子的两种投影，只保留一行「免费额度」
 *   - Total<=0 / 字段缺失跳过；remaining 可能为负，不 clamp
 */
export function mapArkTokenPacks(result: Record<string, unknown>): ArkTokenPack[] {
  const arr = result['Items'];
  if (!Array.isArray(arr)) return [];
  const out: ArkTokenPack[] = [];
  for (const raw of arr) {
    const item = asRecord(raw);
    if (!item) continue;
    const model = typeof item['FoundationModelName'] === 'string' ? (item['FoundationModelName'] as string) : '';
    const displayNameRaw = item['DisplayName'];
    const displayName = typeof displayNameRaw === 'string' && displayNameRaw.trim() ? displayNameRaw : model;
    if (!displayName) continue;

    const free = readTokenPool(item['InferenceFreeUsage']);
    const packs: TokenPool[] = [];
    const rp = item['ResourcePackItems'];
    if (Array.isArray(rp)) {
      for (const pRaw of rp) {
        const p = asRecord(pRaw);
        if (!p || p['Type'] !== 'FreeInference') continue;
        const pool = readTokenPool(p);
        if (pool) packs.push(pool);
      }
    }
    if (!free && packs.length === 0) continue;

    const duplicated =
      free !== null &&
      packs.length === 1 &&
      packs[0].total === free.total &&
      packs[0].consumed === free.consumed;
    if (free) out.push(toTokenPack(model, displayName, '免费额度', free));
    if (!duplicated) {
      for (const pool of packs) out.push(toTokenPack(model, displayName, '资源包', pool));
    }
  }
  return out;
}
