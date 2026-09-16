import assert from 'node:assert/strict';
import test from 'node:test';
import { mapMiniMaxQuota, miniMaxPlanLabel, miniMaxRemainingPercent } from './minimax-subscription';

test('maps MiniMax Coding Plan 5h and 7d windows and surfaces plan label', () => {
  const result = mapMiniMaxQuota({
    data: {
      plan: 'coding_plan',
      windows: [
        { type: 'TOKENS_LIMIT', windowDurationMins: 300, usedPercent: 30, nextResetTime: 1_900_000_000 },
        { type: 'TOKENS_LIMIT', windowDurationMins: 10_080, usedPercent: 0.55, nextResetTime: 1_900_086_400 },
      ],
    },
  });
  assert.equal(result.planLabel, 'Coding Plan');
  assert.deepEqual(result.limits.map((limit) => [limit.id, limit.label, limit.usedPercent, limit.resetsAt]), [
    ['five-hour', '5h', 30, 1_900_000_000],
    ['weekly', '7d', 55, 1_900_086_400],
  ]);
});

test('falls back to primary/secondary named windows when the array is missing', () => {
  const result = mapMiniMaxQuota({
    data: {
      plan: 'plus',
      primary: { usedPercent: 12, windowDurationMins: 300, nextResetTime: 1_900_000_000 },
      secondary: { usedPercent: 0.81, windowDurationMins: 10_080, nextResetTime: 1_900_086_400 },
    },
  });
  assert.equal(result.planLabel, 'Plus');
  assert.deepEqual(result.limits.map((limit) => limit.id), ['five-hour', 'weekly']);
  assert.equal(result.limits[1].usedPercent, 81);
});

test('drops unknown MiniMax windows and returns no quota', () => {
  const result = mapMiniMaxQuota({ data: { windows: [{ usedPercent: 50 }] } });
  assert.deepEqual(result.limits, []);
});

test('returns empty snapshot for missing data envelope', () => {
  assert.deepEqual(mapMiniMaxQuota(null), { planLabel: null, limits: [] });
});

test('normalizes MiniMax plan labels and keeps unknown values verbatim', () => {
  assert.equal(miniMaxPlanLabel('coding_plan'), 'Coding Plan');
  assert.equal(miniMaxPlanLabel('STARTER'), 'Starter');
  assert.equal(miniMaxPlanLabel('Custom-Tier-X'), 'Custom-Tier-X');
  assert.equal(miniMaxPlanLabel(null), null);
});

test('clamps MiniMax remaining percentage to [0, 100]', () => {
  assert.equal(miniMaxRemainingPercent(0), 100);
  assert.equal(miniMaxRemainingPercent(70), 30);
  assert.equal(miniMaxRemainingPercent(150), 0);
  assert.equal(miniMaxRemainingPercent(Number.NaN), 0);
});

// [fork extension] Coding Plan 老 API（model_remains[]）映射测试
test('mapMiniMaxQuota parses model_remains[] 老 API 响应，透出 quota/已用/model/限流/reset', () => {
  // 固定时间戳让 resetsAt 可预测
  const now = 1_700_000_000;
  const result = mapMiniMaxQuota({
    model_remains: [
      {
        model_name: 'general',
        current_interval_total_count: 5000,
        current_interval_usage_count: 1500,
        current_interval_remaining_percent: 70,
        current_interval_status: 1,
        remains_time: 3600,
        current_weekly_total_count: 50_000,
        current_weekly_usage_count: 15_000,
        current_weekly_remaining_percent: 70,
        current_weekly_status: 1,
        weekly_remains_time: 604_800,
      },
    ],
  });
  assert.equal(result.planLabel, null);
  assert.equal(result.limits.length, 2);
  // five-hour
  assert.equal(result.limits[0].id, 'five-hour');
  assert.equal(result.limits[0].label, '5h');
  assert.equal(result.limits[0].usedPercent, 30); // 100 - 70
  assert.equal(result.limits[0].totalCount, 5000);
  assert.equal(result.limits[0].usedCount, 1500);
  assert.equal(result.limits[0].modelName, 'general');
  assert.equal(result.limits[0].rateLimited, false);
  assert.ok(result.limits[0].resetsAt !== null && (result.limits[0].resetsAt as number) > now);
  // weekly
  assert.equal(result.limits[1].id, 'weekly');
  assert.equal(result.limits[1].label, '7d');
  assert.equal(result.limits[1].usedPercent, 30);
  assert.equal(result.limits[1].totalCount, 50_000);
  assert.equal(result.limits[1].usedCount, 15_000);
  assert.ok(result.limits[1].resetsAt !== null && (result.limits[1].resetsAt as number) > now);
});

test('mapMiniMaxQuota model_remains 限流态(status=0) 反映到 rateLimited=true', () => {
  const result = mapMiniMaxQuota({
    model_remains: [
      { model_name: 'general', current_interval_remaining_percent: 50, current_interval_status: 0, current_weekly_remaining_percent: 50, current_weekly_status: 1 },
    ],
  });
  assert.equal(result.limits[0].rateLimited, true);
  assert.equal(result.limits[1].rateLimited, false);
});

test('mapMiniMaxQuota 多 model 时返回最多 2 个 window（5h/weekly），保留 model 名', () => {
  const result = mapMiniMaxQuota({
    model_remains: [
      { model_name: 'general', current_interval_remaining_percent: 80, current_weekly_remaining_percent: 80 },
      { model_name: 'video', current_interval_remaining_percent: 60, current_weekly_remaining_percent: 60 },
    ],
  });
  assert.equal(result.limits.length, 2);
  assert.equal(result.limits[0].modelName, 'general');
  assert.equal(result.limits[1].modelName, 'general'); // 同 model
  // used 来自第一个 model
  assert.equal(result.limits[0].usedPercent, 20);
  assert.equal(result.limits[1].usedPercent, 20);
});

test('mapMiniMaxQuota model_remains 无字段时不挂', () => {
  // 没 total/used/status/model 字段，只有 percent
  const result = mapMiniMaxQuota({
    model_remains: [{ model_name: 'general', current_interval_remaining_percent: 50, current_weekly_remaining_percent: 50 }],
  });
  assert.equal(result.limits[0].totalCount, undefined);
  assert.equal(result.limits[0].usedCount, undefined);
  assert.equal(result.limits[0].modelName, 'general');
  assert.equal(result.limits[0].rateLimited, undefined);
});

test('miniMaxPlanLabel 归一化已知值', () => {
  assert.equal(miniMaxPlanLabel('codingplan'), 'Coding Plan');
  assert.equal(miniMaxPlanLabel('STARTER'), 'Starter');
  assert.equal(miniMaxPlanLabel('plus'), 'Plus');
  assert.equal(miniMaxPlanLabel('pro'), 'Pro');
  assert.equal(miniMaxPlanLabel('unknown-plan'), 'unknown-plan');
});
