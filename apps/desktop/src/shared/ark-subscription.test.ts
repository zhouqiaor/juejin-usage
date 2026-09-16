// SPDX-License-Identifier: MIT
// shared/ark-subscription.test.ts -- 纯函数映射测试（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapArkAfpResult, mapArkCodingPlanResult, mapArkTokenPacks, resolveArkPlanKind, arkPlanTitle, normalizeArkPlanLabel, arkPlanSubtitle } from './ark-subscription';

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

test('mapArkTokenPacks maps InferenceFreeUsage to 免费额度 and ignores DataPermission', () => {
  const out = mapArkTokenPacks({
    Items: [
      {
        FoundationModelName: 'doubao-1.5-pro',
        DisplayName: '豆包 1.5 Pro',
        VendorName: 'Doubao',
        State: 'Available',
        IsOverdue: false,
        InferenceFreeUsage: { Total: 100_000, Consumed: 25_000 },
        ResourcePackItems: [
          { Type: 'DataPermission', Total: 10, Consumed: 1 },
          { Type: 'FreeInference', Total: 100_000, Consumed: 25_000 },
        ],
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].model, 'doubao-1.5-pro');
  assert.equal(out[0].displayName, '豆包 1.5 Pro');
  assert.equal(out[0].label, '免费额度');
  assert.equal(out[0].total, 100_000);
  assert.equal(out[0].consumed, 25_000);
  assert.equal(out[0].remaining, 75_000);
  assert.equal(out[0].usedPercent, 25);
});

test('mapArkTokenPacks emits separate rows when free pool and resource pack differ', () => {
  const out = mapArkTokenPacks({
    Items: [
      {
        FoundationModelName: 'm1',
        InferenceFreeUsage: { Total: 10_000, Consumed: 1_000 },
        ResourcePackItems: [{ Type: 'FreeInference', Total: 50_000, Consumed: 5_000 }],
      },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].label, '免费额度');
  assert.equal(out[0].remaining, 9_000);
  assert.equal(out[1].label, '资源包');
  assert.equal(out[1].total, 50_000);
  assert.equal(out[1].usedPercent, 10);
});

test('mapArkTokenPacks keeps negative remaining (overdue downgrade, no clamp)', () => {
  const out = mapArkTokenPacks({
    Items: [
      {
        FoundationModelName: 'm2',
        InferenceFreeUsage: { Total: 1_000, Consumed: 1_200 },
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].remaining, -200);
  assert.equal(out[0].usedPercent, 100);
});

test('mapArkTokenPacks skips Total<=0 and items with missing fields', () => {
  const out = mapArkTokenPacks({
    Items: [
      { FoundationModelName: 'zero', InferenceFreeUsage: { Total: 0, Consumed: 0 } },
      { FoundationModelName: 'rp-zero', ResourcePackItems: [{ Type: 'FreeInference', Total: 0 }] },
      { FoundationModelName: 'broken', InferenceFreeUsage: { Consumed: 5 } },
      { DisplayName: 'no-model-name', InferenceFreeUsage: { Total: 100, Consumed: 10 } },
      null,
      'garbage',
      { FoundationModelName: 'ok', InferenceFreeUsage: { Total: 200 } },
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].displayName, 'no-model-name');
  assert.equal(out[1].model, 'ok');
  assert.equal(out[1].consumed, 0);
});

test('mapArkTokenPacks tolerates missing/non-array envelopes', () => {
  assert.deepEqual(mapArkTokenPacks({}), []);
  assert.deepEqual(mapArkTokenPacks({ Items: null }), []);
  assert.deepEqual(mapArkTokenPacks({ Items: 'x' }), []);
});

test('mapArkTokenPacks falls back to FoundationModelName when DisplayName absent', () => {
  const out = mapArkTokenPacks({
    Items: [{ FoundationModelName: 'm3', ResourcePackItems: [{ Type: 'FreeInference', Total: 10, Consumed: 2 }] }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].displayName, 'm3');
  assert.equal(out[0].label, '资源包');
});

test('resolveArkPlanKind: AFP(Agent) 窗口更多时为 agent', () => {
  const afp = mapArkAfpResult({ AFPFiveHour: { Quota: 100, Used: 10 }, AFPWeekly: { Quota: 100, Used: 10 } });
  const coding = mapArkCodingPlanResult({ QuotaUsage: [{ Level: 'session', Percent: 10 }] });
  assert.equal(resolveArkPlanKind(afp, coding), 'agent');
});

test('resolveArkPlanKind: Coding 窗口更多时为 coding', () => {
  const afp = mapArkAfpResult({});
  const coding = mapArkCodingPlanResult({
    QuotaUsage: [{ Level: 'session', Percent: 10 }, { Level: 'weekly', Percent: 10 }],
  });
  assert.equal(resolveArkPlanKind(afp, coding), 'coding');
});

test('resolveArkPlanKind: 两接口皆空为 null（未知/未订阅）', () => {
  assert.equal(resolveArkPlanKind({ limits: [] }, { limits: [] }), null);
});

test('resolveArkPlanKind: 等长非空时与 limits 决胜一致归 agent（AFP 优先）', () => {
  assert.equal(resolveArkPlanKind({ limits: [1, 2] }, { limits: [3, 4] }), 'agent');
});

test('arkPlanTitle 按 planKind 出标题，null/undefined 回落中性品牌名', () => {
  assert.equal(arkPlanTitle('agent'), '火山方舟 Agent Plan');
  assert.equal(arkPlanTitle('coding'), '火山方舟 Coding Plan');
  assert.equal(arkPlanTitle(null), '火山方舟');
  assert.equal(arkPlanTitle(undefined), '火山方舟');
});

test('normalizeArkPlanLabel: agent 白名单 small/medium/large/max 大小写规范化，不翻译', () => {
  assert.equal(normalizeArkPlanLabel('agent', 'small'), 'Small');
  assert.equal(normalizeArkPlanLabel('agent', 'MEDIUM'), 'Medium');
  assert.equal(normalizeArkPlanLabel('agent', ' Max '), 'Max');
  assert.equal(normalizeArkPlanLabel('agent', 'large'), 'Large');
});

test('normalizeArkPlanLabel: agent 未知值/空值原样或 null，不臆造', () => {
  assert.equal(normalizeArkPlanLabel('agent', 'enterprise'), 'enterprise');
  assert.equal(normalizeArkPlanLabel('agent', 'Pro'), 'Pro');
  assert.equal(normalizeArkPlanLabel('agent', ''), null);
  assert.equal(normalizeArkPlanLabel('agent', '   '), null);
  assert.equal(normalizeArkPlanLabel('agent', null), null);
  assert.equal(normalizeArkPlanLabel('agent', undefined), null);
});

test('normalizeArkPlanLabel: coding 与未知 kind 原样透传', () => {
  assert.equal(normalizeArkPlanLabel('coding', 'pro'), 'pro');
  assert.equal(normalizeArkPlanLabel('coding', 'Standard'), 'Standard');
  assert.equal(normalizeArkPlanLabel(null, 'medium'), 'medium');
  assert.equal(normalizeArkPlanLabel(undefined, ''), null);
});

test('arkPlanSubtitle: 组合为「Agent Plan · Medium」，无档位名返回 null', () => {
  assert.equal(arkPlanSubtitle('agent', 'medium'), 'Agent Plan · Medium');
  assert.equal(arkPlanSubtitle('agent', 'weird'), 'Agent Plan · weird');
  assert.equal(arkPlanSubtitle('coding', 'pro'), 'Coding Plan · pro');
  assert.equal(arkPlanSubtitle('agent', null), null);
  assert.equal(arkPlanSubtitle(null, 'Pro'), 'Pro');
});