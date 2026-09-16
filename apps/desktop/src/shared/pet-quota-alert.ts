/**
 * Pure state machine for desktop-pet plan-quota threshold alerts.
 *
 * 军规（exec.md §7/§10）：本文件是零框架依赖的纯逻辑核心层——不 import
 * React/Electron/DOM，时间一律由调用方注入 nowMs，状态由调用方持有，
 * 使阈值跨越、迟滞带、冷却、套餐重置等边沿可端到端单测。
 */

export const QUOTA_ALERT_HYSTERESIS = 5;
export const QUOTA_ALERT_THRESHOLDS = [80, 90, 95] as const;
export type QuotaAlertThreshold = (typeof QUOTA_ALERT_THRESHOLDS)[number];

export function isQuotaAlertThreshold(value: unknown): value is QuotaAlertThreshold {
  return typeof value === 'number'
    && (QUOTA_ALERT_THRESHOLDS as readonly number[]).includes(value);
}

/** Normalized usage window. `resetsAt` is epoch ms (null = unknown). */
export interface QuotaWindow {
  provider: string;
  id: string;
  usedPercent: number;
  resetsAt: number | null;
}

export interface QuotaAlertStateEntry {
  /** A crossing is allowed to produce a `fired` event. */
  armed: boolean;
  /** Currently at/over threshold (alert presentation active). */
  active: boolean;
  /** Epoch ms of the last fired event, or null. */
  lastFiredAt: number | null;
  /**
   * The `resetsAt` value whose due reset edge has already been processed, or
   * null. A stale feed that keeps reporting the same due timestamp must not
   * re-arm on every poll: the reset edge fires once per distinct resetsAt.
   */
  handledResetsAt: number | null;
}

export interface QuotaAlert extends QuotaWindow {
  /** Stable identity, `${provider}::${id}`. */
  key: string;
}

export interface EvaluateQuotaAlertsOptions {
  /** 80 / 90 / 95; anything else is a caller bug and throws. */
  threshold: QuotaAlertThreshold;
  /** Suppress repeat firing within this window, even after release+re-cross. */
  cooldownMs: number;
  /** Injected clock (epoch ms). */
  nowMs: number;
  /** Prior state from the previous evaluation, keyed by quotaKey(). */
  state: ReadonlyMap<string, QuotaAlertStateEntry>;
}

export interface EvaluateQuotaAlertsResult {
  /** Windows that crossed into alert on THIS evaluation (edge-triggered). */
  fired: QuotaAlert[];
  /** Fresh state map covering exactly the windows in this evaluation. */
  state: Map<string, QuotaAlertStateEntry>;
  /** Keys currently at/over threshold (level, regardless of fired edge). */
  activeKeys: string[];
}

export function quotaKey(provider: string, id: string): string {
  return `${provider}::${id}`;
}

/**
 * Invalid-percent policy (pinned for callers):
 * - finite but out of [0,100] (e.g. -3, 102) → clamped into [0,100];
 * - non-finite (NaN / Infinity) → the window is ignored entirely: it produces
 *   no fired/active entry and its prior state is dropped for this evaluation.
 */
function normalizePercent(value: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function freshEntry(handledResetsAt: number | null = null): QuotaAlertStateEntry {
  return { armed: true, active: false, lastFiredAt: null, handledResetsAt };
}

/**
 * Evaluate one batch of usage windows against the alert policy:
 *
 * 1. reset edge: when a NEW `resetsAt` value is due (nowMs >= resetsAt and it
 *    differs from the value already handled for this key), the window is
 *    re-armed and its alert cleared regardless of the reported percent; the
 *    same due timestamp is processed only once, so a stale feed that keeps
 *    reporting the old window cannot re-arm/fire on every poll (null resetsAt
 *    means "no reset point known" and never re-arms);
 * 2. release edge: percent below threshold-5 (75/85/90) clears the alert and
 *    re-arms; the hysteresis band itself never fires;
 * 3. fire edge: percent >= threshold, armed, and cooldown elapsed since the
 *    last fired event → fired once, then disarmed until release/reset;
 * 4. cooldown: a re-cross inside cooldownMs marks active but does not fire.
 */
export function evaluateQuotaAlerts(
  windows: readonly QuotaWindow[],
  opts: EvaluateQuotaAlertsOptions,
): EvaluateQuotaAlertsResult {
  if (!isQuotaAlertThreshold(opts.threshold)) {
    throw new RangeError(`threshold must be one of ${QUOTA_ALERT_THRESHOLDS.join('/')}`);
  }
  if (!Number.isFinite(opts.cooldownMs) || opts.cooldownMs < 0) {
    throw new RangeError('cooldownMs must be a finite non-negative number');
  }
  if (!Number.isFinite(opts.nowMs)) {
    throw new RangeError('nowMs must be a finite number');
  }

  const releaseAt = opts.threshold - QUOTA_ALERT_HYSTERESIS;
  const state = new Map<string, QuotaAlertStateEntry>();
  const fired: QuotaAlert[] = [];
  const activeKeys: string[] = [];

  for (const window of windows) {
    const percent = normalizePercent(window.usedPercent);
    if (percent === null || typeof window.provider !== 'string'
      || typeof window.id !== 'string') {
      continue;
    }
    const key = quotaKey(window.provider, window.id);
    const normalized: QuotaAlert = { ...window, usedPercent: percent, key };
    let entry: QuotaAlertStateEntry = { ...(opts.state.get(key) ?? freshEntry()) };

    // 1. Plan period rolled over → re-arm, but only once per distinct
    //    resetsAt. A stale feed repeating the same due timestamp must not
    //    re-arm (and therefore re-fire) on every 60s poll.
    if (window.resetsAt !== null
      && opts.nowMs >= window.resetsAt
      && entry.handledResetsAt !== window.resetsAt) {
      entry = freshEntry(window.resetsAt);
    }

    // 2. Release below the hysteresis band.
    if (entry.active && percent < releaseAt) {
      entry.active = false;
      entry.armed = true;
    }

    if (percent >= opts.threshold) {
      entry.active = true;
      const cooledDown = entry.lastFiredAt === null
        || opts.nowMs - entry.lastFiredAt >= opts.cooldownMs;
      if (entry.armed && cooledDown) {
        fired.push(normalized);
        entry.armed = false;
        entry.lastFiredAt = opts.nowMs;
      }
    }

    if (entry.active) activeKeys.push(key);
    state.set(key, entry);
  }

  return { fired, state, activeKeys };
}
