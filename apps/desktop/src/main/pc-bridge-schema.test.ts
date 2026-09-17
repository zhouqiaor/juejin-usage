// SPDX-License-Identifier: MIT
// main/pc-bridge-schema.test.ts -- v1 契约 mapper 纯函数单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PC_BRIDGE_CONTRACT_VERSION,
  V1_FIXTURE,
  localDateString,
  resolveTodayDate,
  toBridgeSummaryV1,
} from './pc-bridge-schema.js';
import type { HourlyUsageRow, UsageSummary } from '@juejin-opensource/jusage-core';

function coreSummary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    totalTokens: 99999,
    totalCostUsd: 9.99,
    todayTokens: 1234,
    todayCostUsd: 0.12,
    statsSince: '2026-09-01',
    bySource: [],
    ...overrides,
  };
}

function hour(h: Partial<HourlyUsageRow>): HourlyUsageRow {
  return {
    date: '2026-09-17',
    hour: 0,
    source: 'codex',
    tokens: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    ...h,
  };
}

test('契约版本号为 1 且 fixture 是 v1 形态', () => {
  assert.equal(PC_BRIDGE_CONTRACT_VERSION, 1);
  assert.equal(V1_FIXTURE.version, 1);
  assert.ok(V1_FIXTURE.asOf.endsWith('Z'));
  assert.deepEqual(V1_FIXTURE.today.topProjects, []);
});

test('当日 hourly 行按 source 聚合并按 tokens 降序', () => {
  const hours = [
    hour({ hour: 1, source: 'codex', tokens: 400, costUsd: 0.04 }),
    hour({ hour: 2, source: 'workbuddy', tokens: 234, costUsd: 0.02 }),
    hour({ hour: 3, source: 'codex', tokens: 600, costUsd: 0.06 }),
    // 昨日行不计入今日
    hour({ date: '2026-09-16', source: 'codex', tokens: 9999, costUsd: 99 }),
  ];
  const out = toBridgeSummaryV1({
    core: coreSummary(),
    hours,
    todayDate: '2026-09-17',
    asOf: new Date('2026-09-17T08:00:00.000Z'),
  });
  // 与两端共用 fixture 同构（deepEqual 不受键序影响）
  assert.deepEqual(out, V1_FIXTURE);
  // 显式固化键序（降序）
  assert.deepEqual(Object.keys(out.today.bySource), ['codex', 'workbuddy']);
});

test('totals 以 core summary 为准（hourly 仅贡献 bySource）', () => {
  const out = toBridgeSummaryV1({
    core: coreSummary({ todayTokens: 42, todayCostUsd: 0.01 }),
    hours: [hour({ tokens: 7, costUsd: 0.001 })],
    todayDate: '2026-09-17',
    asOf: new Date('2026-09-17T08:00:00.000Z'),
  });
  assert.equal(out.today.totalTokens, 42);
  assert.equal(out.today.totalCostUsd, 0.01);
});

test('无 hourly 行：bySource 为空 map，topProjects 恒空，仍为合法 v1', () => {
  const out = toBridgeSummaryV1({
    core: coreSummary({ todayTokens: 0, todayCostUsd: 0 }),
    hours: [],
    todayDate: '2026-09-17',
    asOf: new Date('2026-09-17T08:00:00.000Z'),
  });
  assert.deepEqual(out.today.bySource, {});
  assert.deepEqual(out.today.topProjects, []);
  assert.equal(out.version, 1);
});

test('resolveTodayDate 取最大日期，空集回退', () => {
  assert.equal(
    resolveTodayDate([hour({ date: '2026-09-16' }), hour({ date: '2026-09-17' })], '2026-09-17'),
    '2026-09-17',
  );
  assert.equal(resolveTodayDate([], '2026-09-11'), '2026-09-11');
});

test('localDateString 输出 YYYY-MM-DD', () => {
  assert.match(localDateString(new Date('2026-09-17T01:02:03')), /^\d{4}-\d{2}-\d{2}$/);
});
