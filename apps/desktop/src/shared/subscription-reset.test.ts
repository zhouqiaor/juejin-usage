// SPDX-License-Identifier: MIT
// shared/subscription-reset.test.ts — 订阅重置时刻纯函数测试（node:test）
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatResetCountdown,
  formatResetCountdownShort,
  formatResetCountdownZh,
} from './subscription-reset.js';

const HOUR = 3_600;

/** GMT+8 挂钟时刻（年, 月, 日, 时, 分）→ epoch 秒。 */
function gmt8Sec(year: number, month: number, day: number, hour: number, minute: number): number {
  return Math.floor((Date.UTC(year, month - 1, day, hour, minute) - 8 * HOUR * 1_000) / 1_000);
}

test('今天内（GMT+8 同一日历日）：短形态 HH:mm，长文案「今天 HH:mm 重置」', () => {
  const nowSec = gmt8Sec(2026, 9, 17, 14, 20);
  const resetSec = gmt8Sec(2026, 9, 17, 16, 35);
  assert.equal(formatResetCountdownShort(resetSec, nowSec), '16:35');
  assert.equal(formatResetCountdownZh(resetSec, nowSec), '今天 16:35 重置');
  assert.equal(formatResetCountdown(resetSec, nowSec), '今天 16:35 重置');
});

test('今天跨分钟边界：23:59 → 次日 00:00 归为今年跨天（MM-dd）', () => {
  const nowSec = gmt8Sec(2026, 9, 17, 23, 59);
  const resetSec = gmt8Sec(2026, 9, 18, 0, 0);
  assert.equal(formatResetCountdownShort(resetSec, nowSec), '09-18');
  assert.equal(formatResetCountdownZh(resetSec, nowSec), '09-18 00:00 重置');
  // 反向：重置点恰在今天 23:59、nowSec 为同日 00:00 → 今天档。
  const earlyNow = gmt8Sec(2026, 9, 17, 0, 0);
  const lateReset = gmt8Sec(2026, 9, 17, 23, 59);
  assert.equal(formatResetCountdownShort(lateReset, earlyNow), '23:59');
  assert.equal(formatResetCountdownZh(lateReset, earlyNow), '今天 23:59 重置');
});

test('今年内跨天：短形态 MM-dd（5ch），长文案 MM-dd HH:mm 重置', () => {
  const nowSec = gmt8Sec(2026, 9, 17, 14, 20);
  const resetSec = gmt8Sec(2026, 10, 14, 8, 0);
  assert.equal(formatResetCountdownShort(resetSec, nowSec), '10-14');
  assert.equal(formatResetCountdownZh(resetSec, nowSec), '10-14 08:00 重置');
  assert.equal(formatResetCountdown(resetSec, nowSec), '10-14 08:00 重置');
});

test('跨年：短形态 YY-MM-dd，长文案 YYYY-MM-dd HH:mm 重置', () => {
  const nowSec = gmt8Sec(2026, 12, 31, 23, 0);
  const resetSec = gmt8Sec(2027, 1, 1, 0, 30);
  assert.equal(formatResetCountdownShort(resetSec, nowSec), '27-01-01');
  assert.equal(formatResetCountdownZh(resetSec, nowSec), '2027-01-01 00:30 重置');
  // 更晚的跨年重置点（月份/日期补零）。
  const march = gmt8Sec(2027, 3, 5, 14, 30);
  assert.equal(formatResetCountdownShort(march, nowSec), '27-03-05');
  assert.equal(formatResetCountdownZh(march, nowSec), '2027-03-05 14:30 重置');
});

test('GMT+8 换算：按注入 epoch（UTC 表达）渲染为北京挂钟，不随机器时区漂移', () => {
  // UTC 2026-09-17T06:20Z = 北京 14:20；UTC 08:35Z = 北京 16:35，同为今天。
  const nowSec = Math.floor(Date.UTC(2026, 8, 17, 6, 20) / 1_000);
  const resetSec = Math.floor(Date.UTC(2026, 8, 17, 8, 35) / 1_000);
  assert.equal(formatResetCountdownShort(resetSec, nowSec), '16:35');
  assert.equal(formatResetCountdownZh(resetSec, nowSec), '今天 16:35 重置');
  // UTC 16:00Z 当日 = 北京次日 00:00 → 跨天档。
  const midnight = Math.floor(Date.UTC(2026, 8, 17, 16, 0) / 1_000);
  assert.equal(formatResetCountdownShort(midnight, nowSec), '09-18');
});

test('过期 / null / 0 / NaN / 负数 / 无效时钟 → null', () => {
  const nowSec = gmt8Sec(2026, 9, 17, 14, 20);
  const resetSec = gmt8Sec(2026, 9, 17, 16, 35);
  assert.equal(formatResetCountdown(0, nowSec), null);
  assert.equal(formatResetCountdown(null, nowSec), null);
  assert.equal(formatResetCountdown(undefined, nowSec), null);
  assert.equal(formatResetCountdown(Number.NaN, nowSec), null);
  assert.equal(formatResetCountdown(-100, nowSec), null);
  assert.equal(formatResetCountdown(resetSec, resetSec), null);
  assert.equal(formatResetCountdown(resetSec, resetSec + 1), null);
  assert.equal(formatResetCountdown(resetSec, Number.NaN), null);
  assert.equal(formatResetCountdownShort(0, nowSec), null);
  assert.equal(formatResetCountdownShort(resetSec, resetSec), null);
  assert.equal(formatResetCountdownZh(0, nowSec), null);
  assert.equal(formatResetCountdownZh(null, nowSec), null);
  assert.equal(formatResetCountdownZh(resetSec, resetSec), null);
});

test('注入时钟稳定：同一入参重复调用逐字节一致，且与相对差值无关', () => {
  const nowSec = gmt8Sec(2026, 9, 17, 14, 20);
  const resetSec = gmt8Sec(2026, 10, 14, 8, 0);
  const expectedShort = formatResetCountdownShort(resetSec, nowSec);
  const expectedZh = formatResetCountdownZh(resetSec, nowSec);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(formatResetCountdownShort(resetSec, nowSec), expectedShort);
    assert.equal(formatResetCountdownZh(resetSec, nowSec), expectedZh);
  }
  // 差值同为 2 天但落在不同日历位置时，输出按重置点日历渲染（09-19 vs 10-14）。
  const twoDaysLater = gmt8Sec(2026, 9, 19, 14, 20);
  assert.equal(formatResetCountdownShort(twoDaysLater, nowSec), '09-19');
});

test('formatResetCountdown 与 formatResetCountdownZh 逐字节一致（卡片长文案同规则）', () => {
  const cases: Array<[number, number]> = [
    [gmt8Sec(2026, 9, 17, 16, 35), gmt8Sec(2026, 9, 17, 14, 20)],
    [gmt8Sec(2026, 10, 14, 8, 0), gmt8Sec(2026, 9, 17, 14, 20)],
    [gmt8Sec(2027, 1, 1, 0, 30), gmt8Sec(2026, 12, 31, 23, 0)],
  ];
  for (const [resetSec, nowSec] of cases) {
    assert.equal(formatResetCountdown(resetSec, nowSec), formatResetCountdownZh(resetSec, nowSec));
  }
});
