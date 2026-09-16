// SPDX-License-Identifier: MIT
// shared/ark-subscription.test.ts -- 纯函数映射测试（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapArkAfpResult, mapArkCodingPlanResult } from './ark-subscription';

test('mapArkAfpResult parses three windows with Quota/Used/ResetTime', () => {
  const result = {
    PlanType: 'pro',
    AFPFiveHour: { Quota: 100, Used: 25, ResetTime: 1_700_000_000 },
    AFPWeekly: { Quota: 1000, Used: 700, ResetTime: 1_700_086_400 },
    AFPMonthly: { Quota: 10000, Used: 2000, ResetTime: 1_702_598_400 },
  };
  const out = mapArkAfpResult(result);
  assert.equal(out.planLabel, 'pro');
  assert.equal(out.limits.length, 3);
  assert.equal(out.limits[0].id, 'five-hour');
  assert.equal(out.limits[0].label, '5h');
  assert.equal(out.limits[0].usedPercent, 25);
  assert.equal(out.limits[0].resetsAt, 1_700_000_000);
  assert.equal(out.limits[1].usedPercent, 70);
  assert.equal(out.limits[2].usedPercent, 20);
});

test('mapArkAfpResult skips zero-quota windows', () => {
  const out = mapArkAfpResult({
    AFPFiveHour: { Quota: 0, Used: 0 },
    AFPWeekly: { Quota: 100, Used: 50 },
  });
  assert.equal(out.limits.length, 1);
  assert.equal(out.limits[0].id, 'weekly');
});

test('mapArkCodingPlanResult maps Level to window id via alias table', () => {
  const out = mapArkCodingPlanResult({
    QuotaUsage: [
      { Level: 'session', Percent: 10, ResetTime: 1_700_000_000 },
      { Level: 'weekly', Percent: 60, ResetTime: 1_700_086_400 },
      { Level: 'month', Percent: 80, ResetTime: 1_702_598_400 },
      { Level: 'unknown_thing', Percent: 50 },
    ],
  });
  assert.equal(out.limits.length, 3);
  assert.equal(out.limits[0].id, 'five-hour');
  assert.equal(out.limits[1].id, 'weekly');
  assert.equal(out.limits[2].id, 'monthly');
});

test('mapArkCodingPlanResult falls back to Usages/Details if QuotaUsage absent', () => {
  const a = mapArkCodingPlanResult({ Usages: [{ Type: '5h', UsedPercent: 30 }] });
  assert.equal(a.limits.length, 1);
  const b = mapArkCodingPlanResult({ Details: [{ Window: '7d', Percent: 40 }] });
  assert.equal(b.limits[0].id, 'weekly');
  assert.equal(b.limits[0].usedPercent, 40);
});

test('parseReset converts ms (>1e12) to seconds', () => {
  const out = mapArkCodingPlanResult({
    QuotaUsage: [{ Level: 'session', Percent: 5, ResetTime: 1_700_000_000_500 }],
  });
  assert.equal(out.limits[0].resetsAt, 1_700_000_000); // 500ms truncated
});

test('empty input returns empty limits', () => {
  assert.deepEqual(mapArkAfpResult({}).limits, []);
  assert.deepEqual(mapArkCodingPlanResult({}).limits, []);
  assert.deepEqual(mapArkCodingPlanResult({ QuotaUsage: [] }).limits, []);
});