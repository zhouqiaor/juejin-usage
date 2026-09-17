// SPDX-License-Identifier: MIT
// shared/freshness.ts — 订阅卡数据新鲜度的纯展示逻辑（零框架/零设备依赖）
//
// 只负责表现层：stale 角标的颜色分级、fetchedAt 的相对/绝对时间格式化、
// tooltip 拼装。30min retain TTL / staleFallback 等数据策略在 main/shared
// 订阅模块里，本文件不碰。

/** stale 持续超过该阈值（秒）从橙色警告升级为红色（retain TTL 为 30 分钟）。 */
export const STALE_DANGER_AFTER_SEC = 5 * 60;

/** 1 小时内显示「n 分钟前更新」，超过则降级为绝对日期时间。 */
const RELATIVE_LIMIT_SEC = 60 * 60;

/** tooltip 中刷新失败原因的最大长度，超出省略。 */
const TOOLTIP_MESSAGE_LIMIT = 40;

export const FRESHNESS_WARN_COLOR = '#f59e0b';
export const FRESHNESS_DANGER_COLOR = '#f04142';

export type FreshnessLevel = 'fresh' | 'stale-warn' | 'stale-danger';

/** fetchedAt（unix 秒）距 now 的秒龄；无时间戳或未来时钟漂移时归一为 null / 0。 */
export function freshnessAgeSec(
  fetchedAtSec: number | null | undefined,
  nowSec: number,
): number | null {
  if (fetchedAtSec == null || !Number.isFinite(fetchedAtSec)) return null;
  return Math.max(0, nowSec - fetchedAtSec);
}

/**
 * stale 分级：
 * - 非 stale → fresh（灰色弱化展示）
 * - stale 且年龄未知（无 fetchedAt）或不足 5 分钟 → stale-warn（琥珀）
 * - stale 且年龄 ≥ 5 分钟 → stale-danger（红，接近 30 分钟 retain TTL）
 */
export function freshnessLevel(
  stale: boolean,
  fetchedAtSec: number | null | undefined,
  nowSec: number,
): FreshnessLevel {
  if (!stale) return 'fresh';
  const age = freshnessAgeSec(fetchedAtSec, nowSec);
  if (age !== null && age >= STALE_DANGER_AFTER_SEC) return 'stale-danger';
  return 'stale-warn';
}

/** 各级别对应的前景色；fresh 返回 null，由调用方沿用 muted 样式。 */
export function freshnessColor(level: FreshnessLevel): string | null {
  if (level === 'stale-danger') return FRESHNESS_DANGER_COLOR;
  if (level === 'stale-warn') return FRESHNESS_WARN_COLOR;
  return null;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** unix 秒 → 本地时区 "HH:mm:ss"；无时间戳返回空串。 */
export function formatHHmmss(fetchedAtSec: number | null | undefined): string {
  if (fetchedAtSec == null || !Number.isFinite(fetchedAtSec)) return '';
  const d = new Date(fetchedAtSec * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** unix 秒 → 本地时区 "MM-dd HH:mm"；无时间戳返回空串。 */
export function formatMMddHHmm(fetchedAtSec: number | null | undefined): string {
  if (fetchedAtSec == null || !Number.isFinite(fetchedAtSec)) return '';
  const d = new Date(fetchedAtSec * 1000);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 实时走动的更新时间文案：
 * - 无 fetchedAt → ''
 * - 不足 60 秒（含时钟漂移造成的负龄）→「刚刚更新」
 * - 不足 60 分钟 →「n 分钟前更新」
 * - 更久 →「MM-dd HH:mm 更新」
 */
export function formatRelativeUpdate(
  fetchedAtSec: number | null | undefined,
  nowSec: number,
): string {
  const age = freshnessAgeSec(fetchedAtSec, nowSec);
  if (age === null) return '';
  if (age < 60) return '刚刚更新';
  if (age < RELATIVE_LIMIT_SEC) return `${Math.floor(age / 60)} 分钟前更新`;
  return `${formatMMddHHmm(fetchedAtSec)} 更新`;
}

/**
 * stale 角标 tooltip：
 * `数据更新于 MM-dd HH:mm，本次刷新失败：<message 省略>；点击重试`
 * 无 message 时省略失败分句；无 fetchedAt 时更新时间记为未知；
 * canRetry=false（宿主卡未接 onRetry）时省略「点击重试」。
 */
export function buildStaleTooltip(
  fetchedAtSec: number | null | undefined,
  message: string | null | undefined,
  canRetry = true,
): string {
  const stamp = formatMMddHHmm(fetchedAtSec);
  const parts: string[] = [stamp ? `数据更新于 ${stamp}` : '数据更新时间未知'];
  const reason = message?.trim();
  if (reason) {
    const omitted =
      reason.length > TOOLTIP_MESSAGE_LIMIT
        ? `${reason.slice(0, TOOLTIP_MESSAGE_LIMIT)}…`
        : reason;
    parts.push(`本次刷新失败：${omitted}`);
  }
  if (canRetry) parts.push('点击重试');
  return parts.join('，');
}
