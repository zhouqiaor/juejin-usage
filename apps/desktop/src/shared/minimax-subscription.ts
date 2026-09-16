/** Read-only subset of the local MiniMax Code account and rate-limit snapshot. */
export type MiniMaxSubscriptionStatus =
  | 'ready'
  | 'custom-provider'
  | 'not-installed'
  | 'not-signed-in'
  | 'unsupported-account'
  | 'expired'
  | 'temporarily-unavailable';

export interface MiniMaxRateLimitWindow {
  id: 'five-hour' | 'weekly';
  label: string;
  usedPercent: number;
  /** Unix timestamp in seconds. */
  resetsAt: number | null;
  // [fork extension] Coding Plan 老 API 透出更多字段
  totalCount?: number;
  usedCount?: number;
  modelName?: string;
  /** 限流状态（API status 字段：1=正常/0=被限） */
  rateLimited?: boolean;
}

export interface MiniMaxSubscriptionSnapshot {
  status: MiniMaxSubscriptionStatus;
  planLabel: string | null;
  /** 'global' | 'mainland' | null — which official region the snapshot belongs to. */
  region: 'global' | 'mainland' | null;
  limits: MiniMaxRateLimitWindow[];
  /** Unix timestamp in seconds. */
  fetchedAt: number | null;
  stale: boolean;
  message: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedPercent(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  // Proto3 omits scalar zeros. Accept either 0..1 fractions or 0..100 percentages.
  const normalized = number <= 1 ? number * 100 : number;
  return Math.round(Math.min(100, Math.max(0, normalized)) * 100) / 100;
}

function resetAt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value > 10_000_000_000 ? value / 1_000 : value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1_000) : null;
}

export function miniMaxPlanLabel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const labels: Record<string, string> = {
    codingplan: 'Coding Plan',
    starter: 'Starter',
    plus: 'Plus',
    pro: 'Pro',
    highspeed: 'HighSpeed',
    free: 'Free',
  };
  return labels[normalized] ?? value.trim();
}

interface RawMiniMaxWindow {
  type?: unknown;
  windowDurationMins?: unknown;
  usedPercent?: unknown;
  resetsAt?: unknown;
  nextResetTime?: unknown;
}

function pickWindow(raw: RawMiniMaxWindow | null): MiniMaxRateLimitWindow | null {
  if (!raw) return null;
  const usedPercent = boundedPercent(raw.usedPercent);
  if (usedPercent === null) return null;
  const minutes = Number(raw.windowDurationMins);
  const resetsAt = resetAt(raw.resetsAt ?? raw.nextResetTime);
  // The Coding Plan endpoint discriminates windows by duration; bucket the
  // 5-hour rolling window separately from the weekly pool so the tray card
  // can render two concentric rings.
  if (Number.isFinite(minutes)) {
    if (minutes >= 240 && minutes <= 360) {
      return { id: 'five-hour', label: '5h', usedPercent, resetsAt };
    }
    if (minutes >= 10_000 && minutes <= 10_200) {
      return { id: 'weekly', label: '7d', usedPercent, resetsAt };
    }
  }
  return null;
}

/** Normalize MiniMax Code's Coding Plan `token_plan/remains` response. */
export function mapMiniMaxQuota(value: unknown): Pick<
  MiniMaxSubscriptionSnapshot,
  'planLabel' | 'limits'
> {
  const root = asRecord(value);
  const data = asRecord(root?.data) ?? root;
  if (!data) return { planLabel: null, limits: [] };

  const planLabel = miniMaxPlanLabel(
    data.plan ?? data.planType ?? data.level ?? data.plan_name ?? data.planName,
  );

  let fiveHour: MiniMaxRateLimitWindow | null = null;
  let weekly: MiniMaxRateLimitWindow | null = null;

  const buckets: unknown[] = [];
  if (Array.isArray(data.windows)) buckets.push(...data.windows);
  if (Array.isArray(data.rateLimits)) buckets.push(...data.rateLimits);
  if (Array.isArray(data.limits)) buckets.push(...data.limits);
  const primary = asRecord(data.primary ?? data.fiveHour);
  const secondary = asRecord(data.secondary ?? data.weekly);
  if (primary) buckets.push(primary);
  if (secondary) buckets.push(secondary);
  // [fork extension] Coding Plan 老 API 响应：{ model_remains: [{ current_interval_remaining_percent, current_weekly_remaining_percent, ... }] }
  // 直接用每项的 remaining 字段构造 window（5h/weekly），不依赖 buckets/pickWindow。
  const modelRemains = Array.isArray(data.model_remains) ? data.model_remains as unknown[] : [];
  if (modelRemains.length > 0) {
    const fiveHour: MiniMaxRateLimitWindow = {
      id: 'five-hour',
      label: '5h',
      usedPercent: 0,
      resetsAt: null,
    };
    const weekly: MiniMaxRateLimitWindow = {
      id: 'weekly',
      label: '7d',
      usedPercent: 0,
      resetsAt: null,
    };
    let hasFiveHour = false;
    let hasWeekly = false;
    let fiveHourResetsAt: number | null = null;
    let weeklyResetsAt: number | null = null;
    for (const itemRaw of modelRemains) {
      const item = asRecord(itemRaw);
      if (!item) continue;
      const fiveHrPct = Number(item.current_interval_remaining_percent);
      if (Number.isFinite(fiveHrPct) && !hasFiveHour) {
        fiveHour.usedPercent = Math.max(0, Math.min(100, 100 - fiveHrPct));
        // [fork extension] 透出总配额 + 已用次数 + model + 限流态
        const total = Number(item.current_interval_total_count);
        const used = Number(item.current_interval_usage_count);
        if (Number.isFinite(total)) fiveHour.totalCount = total;
        if (Number.isFinite(used)) fiveHour.usedCount = used;
        const modelName = String(item.model_name ?? '');
        if (modelName) fiveHour.modelName = modelName;
        const intervalStatus = Number(item.current_interval_status);
        if (Number.isFinite(intervalStatus)) fiveHour.rateLimited = intervalStatus === 0;
        hasFiveHour = true;
        const r = item.remains_time ?? item.current_interval_end_time;
        if (r != null) {
          const n = Number(r);
          if (Number.isFinite(n) && n > 0) fiveHourResetsAt = Math.floor(Date.now() / 1000) + n;
        }
      }
      const wkPct = Number(item.current_weekly_remaining_percent);
      if (Number.isFinite(wkPct) && !hasWeekly) {
        weekly.usedPercent = Math.max(0, Math.min(100, 100 - wkPct));
        const wTotal = Number(item.current_weekly_total_count);
        const wUsed = Number(item.current_weekly_usage_count);
        if (Number.isFinite(wTotal)) weekly.totalCount = wTotal;
        if (Number.isFinite(wUsed)) weekly.usedCount = wUsed;
        const wModel = String(item.model_name ?? '');
        if (wModel && !weekly.modelName) weekly.modelName = wModel;
        const weeklyStatus = Number(item.current_weekly_status);
        if (Number.isFinite(weeklyStatus)) weekly.rateLimited = weeklyStatus === 0;
        hasWeekly = true;
        const r = item.weekly_remains_time ?? item.current_weekly_end_time;
        if (r != null) {
          const n = Number(r);
          if (Number.isFinite(n) && n > 0) weeklyResetsAt = Math.floor(Date.now() / 1000) + n;
        }
      }
    }
    if (hasFiveHour) fiveHour.resetsAt = fiveHourResetsAt;
    if (hasWeekly) weekly.resetsAt = weeklyResetsAt;
    if (hasFiveHour || hasWeekly) {
      return {
        planLabel,
        limits: [hasFiveHour ? fiveHour : null, hasWeekly ? weekly : null].filter(Boolean) as MiniMaxRateLimitWindow[],
      };
    }
  }

  for (const item of buckets) {
    const window = pickWindow(asRecord(item) as RawMiniMaxWindow | null);
    if (!window) continue;
    if (window.id === 'five-hour' && !fiveHour) fiveHour = window;
    if (window.id === 'weekly' && !weekly) weekly = window;
  }

  const limits: MiniMaxRateLimitWindow[] = [];
  if (fiveHour) limits.push(fiveHour);
  if (weekly) limits.push(weekly);
  return { planLabel, limits };
}

export function miniMaxRemainingPercent(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0;
  return Math.min(100, Math.max(0, 100 - usedPercent));
}
