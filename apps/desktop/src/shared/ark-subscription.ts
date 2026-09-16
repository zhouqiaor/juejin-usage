// SPDX-License-Identifier: MIT
// shared/ark-subscription.ts — Ark Coding Plan / Agent Plan 适配类型与纯映射
export interface ArkRateLimitWindow {
  id: 'five-hour' | 'weekly' | 'monthly';
  label: string;
  usedPercent: number;
  resetsAt: number | null;
}

export interface ArkSubscriptionSnapshot {
  status: 'ready' | 'not-configured' | 'auth-error' | 'custom-provider' | 'temporarily-unavailable';
  planLabel: string | null;
  limits: ArkRateLimitWindow[];
  fetchedAt: number | null;
  stale: boolean;
  message: string | null;
}

const WINDOW_LABEL: Record<ArkRateLimitWindow['id'], string> = {
  'five-hour': '5h',
  weekly: '7d',
  monthly: '30d',
};

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
