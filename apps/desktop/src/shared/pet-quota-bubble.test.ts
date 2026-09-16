// SPDX-License-Identifier: MIT
// shared/pet-quota-bubble.test.ts — 宠物套餐余量气泡纯逻辑测试（node:test）
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ArkRateLimitWindow,
  ArkSubscriptionSnapshot,
  ArkTokenPack,
} from './ark-subscription.js';
import { mapArkAfpResult } from './ark-subscription.js';
import {
  buildPetQuotaBubbleModel,
  formatQuotaPercent,
  formatQuotaResetLabel,
  orderArkRateLimits,
  resolveMergedPetBubble,
  selectNextResetSec,
  selectTightestTokenPack,
} from './pet-quota-bubble.js';

function limit(
  id: ArkRateLimitWindow['id'],
  usedPercent: number,
  resetsAt: number | null,
): ArkRateLimitWindow {
  const label = id === 'five-hour' ? '5h' : id === 'weekly' ? '7d' : '30d';
  return { id, label, usedPercent, resetsAt };
}

function pack(
  model: string,
  total: number,
  consumed: number,
): ArkTokenPack {
  return {
    model,
    displayName: model,
    label: '免费额度',
    total,
    consumed,
    remaining: total - consumed,
    usedPercent: Math.round((consumed / total) * 10000) / 100,
  };
}

function snapshot(
  limits: ArkRateLimitWindow[],
  tokenPacks: ArkTokenPack[] = [],
  planLabel: string | null = null,
): ArkSubscriptionSnapshot {
  return {
    status: 'ready',
    planLabel,
    limits,
    tokenPacks,
    tokenPacksError: null,
    fetchedAt: null,
    stale: false,
    message: null,
  };
}

test('orderArkRateLimits sorts to five-hour/weekly/monthly and drops duplicates', () => {
  const input = [
    limit('monthly', 10, 300),
    limit('five-hour', 20, 100),
    limit('weekly', 30, 200),
    limit('five-hour', 99, 101),
  ];
  const ordered = orderArkRateLimits(input);
  assert.deepEqual(ordered.map((w) => w.id), ['five-hour', 'weekly', 'monthly']);
  // 重复 id 保留先出现者
  assert.equal(ordered[0].usedPercent, 20);
  // 不修改入参
  assert.equal(input[0].id, 'monthly');
});

test('orderArkRateLimits tolerates a missing window', () => {
  assert.deepEqual(
    orderArkRateLimits([limit('monthly', 5, 1), limit('five-hour', 5, 1)]).map((w) => w.id),
    ['five-hour', 'monthly'],
  );
  assert.deepEqual(orderArkRateLimits([]), []);
});

test('selectTightestTokenPack picks the lowest remaining/total ratio', () => {
  const a = pack('model-a', 100, 10); // 0.9
  const b = pack('model-b', 200, 180); // 0.1
  const c = pack('model-c', 50, 20); // 0.6
  assert.equal(selectTightestTokenPack([a, b, c]), b);
});

test('selectTightestTokenPack handles negative remaining and keeps first tie', () => {
  const a = pack('model-a', 100, 100); // 0
  const b = pack('model-b', 100, 120); // -0.2
  const c = pack('model-c', 100, 80); // 0.2
  assert.equal(selectTightestTokenPack([a, b, c]), b);

  const tie1 = pack('tie-1', 100, 50);
  const tie2 = pack('tie-2', 100, 50);
  assert.equal(selectTightestTokenPack([tie1, tie2]), tie1);
});

test('selectTightestTokenPack skips invalid totals and returns null when empty', () => {
  const invalid: ArkTokenPack = { ...pack('bad', 0, 0), total: 0 };
  const good = pack('good', 10, 9);
  assert.equal(selectTightestTokenPack([invalid, good]), good);
  assert.equal(selectTightestTokenPack([invalid]), null);
  assert.equal(selectTightestTokenPack([]), null);
});

test('selectNextResetSec returns the soonest future reset against injected now', () => {
  const limits = [
    limit('five-hour', 1, 1_800),
    limit('weekly', 2, 2_000),
    limit('monthly', 3, 1_500),
  ];
  // now = 1_600_000 ms：1_500 已过期，最近未来为 1_800
  assert.equal(selectNextResetSec(limits, 1_600_000), 1_800);
  // 全部过期
  assert.equal(selectNextResetSec(limits, 9_999_000), null);
});

test('selectNextResetSec ignores null and non-finite resets', () => {
  const limits = [
    limit('five-hour', 1, null),
    { ...limit('weekly', 2, 2_000), resetsAt: Number.NaN },
    limit('monthly', 3, 5_000),
  ];
  assert.equal(selectNextResetSec(limits, 1_000_000), 5_000);
  assert.equal(selectNextResetSec([limit('five-hour', 1, null)], 0), null);
});

test('formatQuotaPercent rounds and clamps into 0..100', () => {
  assert.equal(formatQuotaPercent(86.6), '87%');
  assert.equal(formatQuotaPercent(0.4), '0%');
  assert.equal(formatQuotaPercent(-5), '0%');
  assert.equal(formatQuotaPercent(140), '100%');
  assert.equal(formatQuotaPercent(Number.NaN), '0%');
});

test('formatQuotaResetLabel pads and suffixes in renderer local time', () => {
  const sec = 1_700_000_000; // 2023-11-14T22:13:20Z
  const date = new Date(sec * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const expected = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())} 重置`;
  assert.equal(formatQuotaResetLabel(sec), expected);
});

test('formatQuotaResetLabel returns null for absent/invalid timestamps', () => {
  assert.equal(formatQuotaResetLabel(null), null);
  assert.equal(formatQuotaResetLabel(0), null);
  assert.equal(formatQuotaResetLabel(Number.NaN), null);
});

test('buildPetQuotaBubbleModel hides when neither limits nor tokenPacks exist', () => {
  assert.equal(buildPetQuotaBubbleModel(snapshot([]), 1_000_000), null);
  const authError: ArkSubscriptionSnapshot = {
    ...snapshot([]),
    status: 'auth-error',
  };
  assert.equal(buildPetQuotaBubbleModel(authError, 1_000_000), null);
});

test('buildPetQuotaBubbleModel shows token-only accounts (no limits)', () => {
  const model = buildPetQuotaBubbleModel(snapshot([], [pack('m', 100, 40)]), 0);
  assert.ok(model);
  assert.deepEqual(model.limits, []);
  assert.equal(model.tightestPack?.model, 'm');
  assert.equal(model.nextResetSec, null);
});

test('buildPetQuotaBubbleModel assembles ordered limits, tightest pack and next reset', () => {
  const snap = snapshot(
    [limit('monthly', 30, 9_000), limit('five-hour', 80, 2_000), limit('weekly', 10, 5_000)],
    [pack('a', 100, 10), pack('b', 100, 90)],
    'Coding Plan',
  );
  const model = buildPetQuotaBubbleModel(snap, 1_000_000);
  assert.ok(model);
  assert.equal(model.planLabel, 'Coding Plan');
  assert.deepEqual(model.limits.map((w) => w.id), ['five-hour', 'weekly', 'monthly']);
  assert.equal(model.tightestPack?.model, 'b');
  assert.equal(model.nextResetSec, 2_000);
});

test('Agent Plan (AFP) snapshot surfaces the 5h window first in the bubble', () => {
  // 真实 GetAFPUsage Result 形状（AFPFiveHour/AFPWeekly/AFPMonthly）
  const afp = mapArkAfpResult({
    PlanType: 'pro',
    AFPFiveHour: { Quota: 1000, Used: 420, ResetTime: 1_800 },
    AFPWeekly: { Quota: 10_000, Used: 2000, ResetTime: 200_000 },
    AFPMonthly: { Quota: 40_000, Used: 1000, ResetTime: 900_000 },
  });
  assert.deepEqual(afp.limits.map((w) => w.id), ['five-hour', 'weekly', 'monthly']);
  const model = buildPetQuotaBubbleModel(
    { ...snapshot(afp.limits, [], afp.planLabel), planKind: 'agent' },
    1_000_000,
  );
  assert.ok(model);
  assert.deepEqual(model.limits.map((w) => w.id), ['five-hour', 'weekly', 'monthly']);
  assert.equal(model.limits[0].id, 'five-hour');
  assert.equal(model.limits[0].label, '5h');
  assert.equal(model.limits[0].usedPercent, 42);
  // 5h 窗口的重置点最近，气泡尾部倒计时取它
  assert.equal(model.nextResetSec, 1_800);
});

test('resolveMergedPetBubble off mode: only clicks show the today-only bubble', () => {
  const base = {
    mode: 'off' as const,
    periodicOpen: false,
    todayCollapsed: false,
    quotaReady: true,
    syncActive: false,
  };
  assert.deepEqual(
    resolveMergedPetBubble({ ...base, tooltipOpen: false }),
    { bubbleVisible: false, showSync: false, showToday: false, showQuota: false, summaryPollActive: false },
  );
  const open = resolveMergedPetBubble({ ...base, tooltipOpen: true });
  assert.deepEqual(
    open,
    { bubbleVisible: true, showSync: false, showToday: true, showQuota: false, summaryPollActive: true },
  );
});

test('resolveMergedPetBubble persistent: always visible; quota section independent of data; click collapses today', () => {
  const base = {
    mode: 'persistent' as const,
    periodicOpen: false,
    tooltipOpen: false,
    syncActive: false,
  };
  const ready = resolveMergedPetBubble({ ...base, quotaReady: true, todayCollapsed: false });
  assert.deepEqual(
    [ready.bubbleVisible, ready.showToday, ready.showQuota, ready.summaryPollActive],
    [true, true, true, true],
  );
  // 无任何套餐数据：气泡仍常驻，只剩今日区
  const noQuota = resolveMergedPetBubble({ ...base, quotaReady: false, todayCollapsed: false });
  assert.deepEqual([noQuota.bubbleVisible, noQuota.showToday, noQuota.showQuota], [true, true, false]);
  // 点击 sprite 收起今日：额度区不受影响
  const collapsed = resolveMergedPetBubble({ ...base, quotaReady: true, todayCollapsed: true });
  assert.deepEqual([collapsed.bubbleVisible, collapsed.showToday, collapsed.showQuota], [true, false, true]);
});

test('resolveMergedPetBubble periodic and sync override', () => {
  const base = {
    mode: 'periodic' as const,
    tooltipOpen: false,
    todayCollapsed: false,
    quotaReady: true,
  };
  const closed = resolveMergedPetBubble({ ...base, periodicOpen: false, syncActive: false });
  assert.equal(closed.bubbleVisible, false);
  // 窗口之间仍预取今日统计
  assert.equal(closed.summaryPollActive, true);
  const open = resolveMergedPetBubble({ ...base, periodicOpen: true, syncActive: false });
  assert.deepEqual([open.bubbleVisible, open.showToday, open.showQuota], [true, true, true]);
  // sync 庆祝临时覆盖两个分区
  const sync = resolveMergedPetBubble({ ...base, periodicOpen: true, syncActive: true });
  assert.deepEqual([sync.bubbleVisible, sync.showSync, sync.showToday, sync.showQuota], [true, true, false, false]);
});
