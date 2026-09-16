import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapMiniMaxQuota,
  miniMaxHasRealCount,
  miniMaxPlanLabel,
  miniMaxRemainingPercent,
  miniMaxRemainingPercentText,
  retainMiniMaxSnapshotOnEmpty,
  type MiniMaxSubscriptionSnapshot,
} from './minimax-subscription';

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
  // 右值口径：API 剩余 70% → usedPercent 30 → 右值文本 70%（与进度条填充一致）
  assert.equal(miniMaxRemainingPercentText(result.limits[0].usedPercent), '70%');
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

const readySnapshot: MiniMaxSubscriptionSnapshot = {
  status: 'ready',
  planLabel: 'Coding Plan',
  region: 'mainland',
  limits: [
    { id: 'five-hour', label: '5h', usedPercent: 30, resetsAt: null },
    { id: 'weekly', label: '7d', usedPercent: 10, resetsAt: null },
  ],
  fetchedAt: 1_700_000_000,
  stale: false,
  message: null,
};

const emptySnapshot: MiniMaxSubscriptionSnapshot = {
  status: 'temporarily-unavailable',
  planLabel: null,
  region: null,
  limits: [],
  fetchedAt: null,
  stale: false,
  message: '网络异常',
};

test('retainMiniMaxSnapshotOnEmpty: 新快照为空且有旧数据时保留旧数据并标 stale', () => {
  const merged = retainMiniMaxSnapshotOnEmpty(readySnapshot, emptySnapshot, 1_700_000_010);
  assert.equal(merged.status, 'ready');
  assert.equal(merged.limits.length, 2);
  assert.equal(merged.region, 'mainland');
  assert.equal(merged.stale, true);
  // 新快照的失败原因透传给 stale 消息
  assert.equal(merged.message, '网络异常');
});

test('retainMiniMaxSnapshotOnEmpty: 新快照非空时直接采用', () => {
  const merged = retainMiniMaxSnapshotOnEmpty(readySnapshot, { ...readySnapshot, stale: false, limits: [readySnapshot.limits[0]] });
  assert.equal(merged.limits.length, 1);
  assert.equal(merged.stale, false);
});

test('retainMiniMaxSnapshotOnEmpty: 首次加载无旧数据时空快照原样返回（loading 态不变）', () => {
  const merged = retainMiniMaxSnapshotOnEmpty(emptySnapshot, emptySnapshot);
  assert.equal(merged, emptySnapshot);
  assert.equal(merged.limits.length, 0);
  assert.equal(merged.stale, false);
});

// [fork fix] 鉴权失效类空快照必须放行，不能被旧 ready 快照永久掩盖
test('retainMiniMaxSnapshotOnEmpty: expired 空快照不保留旧数据，原样放行重新登录提示', () => {
  const expired: MiniMaxSubscriptionSnapshot = {
    ...emptySnapshot,
    status: 'expired',
    message: 'MiniMax Code 登录已过期，请重新登录',
  };
  const merged = retainMiniMaxSnapshotOnEmpty(readySnapshot, expired, 1_700_000_001);
  assert.equal(merged, expired);
  assert.equal(merged.status, 'expired');
  assert.equal(merged.limits.length, 0);
  assert.equal(merged.stale, false);
});

test('retainMiniMaxSnapshotOnEmpty: not-signed-in / unsupported-account 同样不保留', () => {
  for (const status of ['not-signed-in', 'unsupported-account'] as const) {
    const incoming: MiniMaxSubscriptionSnapshot = { ...emptySnapshot, status };
    const merged = retainMiniMaxSnapshotOnEmpty(readySnapshot, incoming, 1_700_000_001);
    assert.equal(merged, incoming, `${status} 应原样放行`);
  }
});

test('retainMiniMaxSnapshotOnEmpty: 临时失败 30 分钟内保留旧快照并标 stale', () => {
  const fetchedAt = 1_700_000_000;
  const prev = { ...readySnapshot, fetchedAt };
  const merged = retainMiniMaxSnapshotOnEmpty(prev, emptySnapshot, fetchedAt + 1_799);
  assert.equal(merged.status, 'ready');
  assert.equal(merged.limits.length, 2);
  assert.equal(merged.stale, true);
  assert.equal(merged.message, '网络异常');
});

test('retainMiniMaxSnapshotOnEmpty: 旧快照超过 30 分钟 TTL 后不再保留（僵尸快照放行）', () => {
  const fetchedAt = 1_700_000_000;
  const prev = { ...readySnapshot, fetchedAt };
  // 恰好 30 分钟（边界）仍保留
  assert.equal(retainMiniMaxSnapshotOnEmpty(prev, emptySnapshot, fetchedAt + 1_800).status, 'ready');
  // 超过 30 分钟放行 incoming
  const merged = retainMiniMaxSnapshotOnEmpty(prev, emptySnapshot, fetchedAt + 1_801);
  assert.equal(merged, emptySnapshot);
  assert.equal(merged.status, 'temporarily-unavailable');
  assert.equal(merged.limits.length, 0);
});

test('retainMiniMaxSnapshotOnEmpty: 旧快照 fetchedAt 为 null 时不保留', () => {
  const prev = { ...readySnapshot, fetchedAt: null };
  const merged = retainMiniMaxSnapshotOnEmpty(prev, emptySnapshot, 1_700_000_100);
  assert.equal(merged, emptySnapshot);
});

// 右值口径回归：右值显「剩余百分比」，与其余 14 张订阅卡及进度条填充一致
test('miniMaxRemainingPercentText: 入参为 usedPercent，输出剩余百分比；缺失时回退 -- 而非 0%', () => {
  assert.equal(miniMaxRemainingPercentText(81.6), '18%'); // 剩余 18.4 → 18%
  assert.equal(miniMaxRemainingPercentText(0), '100%');
  assert.equal(miniMaxRemainingPercentText(100), '0%');
  assert.equal(miniMaxRemainingPercentText(-5), '100%'); // 剩余钳到 [0,100]
  assert.equal(miniMaxRemainingPercentText(120), '0%');
  assert.equal(miniMaxRemainingPercentText(Number.NaN), '--');
  assert.equal(miniMaxRemainingPercentText(Number.POSITIVE_INFINITY), '--');
});

test('miniMaxHasRealCount: 仅 usedCount/totalCount 均为真实正数时成立，0/0/null 不显示', () => {
  assert.equal(miniMaxHasRealCount({ usedCount: 12, totalCount: 100 }), true);
  assert.equal(miniMaxHasRealCount({ usedCount: 0, totalCount: 0 }), false);
  assert.equal(miniMaxHasRealCount({}), false);
  assert.equal(miniMaxHasRealCount({ usedCount: 0, totalCount: 100 }), false);
  assert.equal(miniMaxHasRealCount({ usedCount: 12, totalCount: 0 }), false);
  assert.equal(miniMaxHasRealCount({ usedCount: Number.NaN, totalCount: 100 }), false);
});

test('mapMiniMaxQuota model_remains count 为 0 时仍透出真实 usedPercent（右值不依赖 count）', () => {
  const result = mapMiniMaxQuota({
    data: {
      model_remains: [
        {
          model_name: 'general',
          current_interval_remaining_percent: 18,
          current_interval_total_count: 0,
          current_interval_usage_count: 0,
        },
      ],
    },
  });
  assert.equal(result.limits[0].usedPercent, 82);
  assert.equal(miniMaxHasRealCount(result.limits[0]), false);
  // 右值是剩余百分比：API remaining 18 → 文本 18%
  assert.equal(miniMaxRemainingPercentText(result.limits[0].usedPercent), '18%');
});
