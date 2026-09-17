// SPDX-License-Identifier: MIT
// shared/subscription-reset.ts — 订阅窗口「重置时刻」纯格式化核心层
//
// 军规（exec.md §7/§10）：零 React/Electron/DOM/date-fns 依赖；当前时刻由
// 调用方以 nowSec（epoch 秒）注入，跨档位边界可端到端单测。渲染层只在快照
// 刷新时静态调用，过期/无效一律返回 null（调用方不渲染，不挂「已过期」文案）。
//
// 统一渲染「具体刷新时刻」（固定 GMT+8，不随运行机器时区漂移），不再输出
// 相对倒计时：
// - 气泡短形态（宽度敏感）：今天 → `HH:mm`；今年内跨天 → `MM-dd`；
//   跨年 → `YY-MM-dd`；
// - 完整中文（卡片 resetLabel / 气泡 title / aria-label）：
//   今天 → `今天 HH:mm 重置`；今年内跨天 → `MM-dd HH:mm 重置`；
//   跨年 → `YYYY-MM-dd HH:mm 重置`。

const SECONDS_PER_HOUR = 3_600;
/** 绝对时间固定按 GMT+8 渲染（不随运行机器时区漂移）。 */
const GMT_PLUS_8_MS = 8 * SECONDS_PER_HOUR * 1_000;

/** 校验入参并要求重置点严格晚于当前时刻（向下取整到秒边界）；无效/过期 → null。 */
function validFutureSec(resetsAtSec: number | null | undefined, nowSec: number): number | null {
  if (
    typeof resetsAtSec !== 'number'
    || !Number.isFinite(resetsAtSec)
    || resetsAtSec <= 0
    || typeof nowSec !== 'number'
    || !Number.isFinite(nowSec)
  ) {
    return null;
  }
  const reset = Math.floor(resetsAtSec);
  return reset - Math.floor(nowSec) > 0 ? reset : null;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

interface Gmt8CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** epoch 秒 → GMT+8 日历零件（按 UTC getter 读取，偏移在入参时补上）。 */
function gmt8Parts(sec: number): Gmt8CalendarParts {
  const date = new Date(sec * 1_000 + GMT_PLUS_8_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function isSameGmt8Day(a: Gmt8CalendarParts, b: Gmt8CalendarParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function timeOfDay(parts: Gmt8CalendarParts): string {
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function monthDay(parts: Gmt8CalendarParts): string {
  return `${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * 重置时刻短形态（供极窄气泡行内右列，固定 5ch 宽）：
 * - 重置点在今天（GMT+8 本地日历日相同）→ `HH:mm`，如 `16:35`；
 * - 今年内跨天 → `MM-dd`，如 `10-14`；
 * - 跨年 → `YY-MM-dd`（两位年），如 `27-01-05`；
 * - resetsAtSec 为 null/0/NaN/负数，或时间点已过/nowSec 无效 → null。
 *
 * @param resetsAtSec 重置点 epoch 秒（各 provider parseTimestamp 已归一为秒）
 * @param nowSec 当前时刻 epoch 秒（调用方注入，不读系统时钟）
 */
export function formatResetCountdownShort(
  resetsAtSec: number | null | undefined,
  nowSec: number,
): string | null {
  const reset = validFutureSec(resetsAtSec, nowSec);
  if (reset === null) return null;
  const resetParts = gmt8Parts(reset);
  const nowParts = gmt8Parts(Math.floor(nowSec));
  if (isSameGmt8Day(resetParts, nowParts)) return timeOfDay(resetParts);
  if (resetParts.year === nowParts.year) return monthDay(resetParts);
  return `${pad2(resetParts.year % 100)}-${monthDay(resetParts)}`;
}

/**
 * 重置时刻完整中文文案（不带窗口名，窗口名由调用方拼，如
 * 「5h 窗口 今天 16:35 重置」）：
 * - 今天 → `今天 HH:mm 重置`；
 * - 今年内跨天 → `MM-dd HH:mm 重置`；
 * - 跨年 → `YYYY-MM-dd HH:mm 重置`；
 * - 无效/过期 → null。
 */
export function formatResetCountdownZh(
  resetsAtSec: number | null | undefined,
  nowSec: number,
): string | null {
  const reset = validFutureSec(resetsAtSec, nowSec);
  if (reset === null) return null;
  const resetParts = gmt8Parts(reset);
  const nowParts = gmt8Parts(Math.floor(nowSec));
  const clock = timeOfDay(resetParts);
  if (isSameGmt8Day(resetParts, nowParts)) return `今天 ${clock} 重置`;
  if (resetParts.year === nowParts.year) return `${monthDay(resetParts)} ${clock} 重置`;
  return `${resetParts.year}-${monthDay(resetParts)} ${clock} 重置`;
}

/**
 * 重置时刻长文案（卡片 resetLabel 用）。与 formatResetCountdownZh 同规则：
 * `今天 HH:mm 重置` / `MM-dd HH:mm 重置` / `YYYY-MM-dd HH:mm 重置`；
 * 无效/过期 → null。
 *
 * 历史上本函数输出相对倒计时（`2h 15m 后重置`），函数名为兼容 13 张订阅卡
 * 的既有 import 保留；语义已随产品规则改为绝对时刻。
 */
export function formatResetCountdown(
  resetsAtSec: number | null | undefined,
  nowSec: number,
): string | null {
  return formatResetCountdownZh(resetsAtSec, nowSec);
}
