// SPDX-License-Identifier: MIT
// pet-mood.test.ts — M0 情绪状态层 node:test 用例（零依赖，node --test 直跑）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PET_MOOD_ALERT_THRESHOLD,
  resolvePetMood,
  type MoodInputWindow,
  type MoodWindowId,
  type PetMood,
  type PetMoodInput,
} from './pet-mood.js';

function win(
  provider: string,
  id: MoodWindowId,
  usedPercent: number,
  resetsAt: number | null = null,
): MoodInputWindow {
  return { provider, id, usedPercent, resetsAt };
}

function input(over: Partial<PetMoodInput> = {}): PetMoodInput {
  return {
    windows: [],
    status: 'ready',
    stale: false,
    nowSec: 1_000,
    lastResetFireKey: null,
    ...over,
  };
}

describe('百分比分层边界（单 provider 5h，默认阈值 90）', () => {
  const cases: ReadonlyArray<[number, PetMood]> = [
    [0, 'healthy'],
    [59.99, 'healthy'],
    [60, 'loaded'],
    [79.99, 'loaded'],
    [80, 'tense'],
    [89, 'tense'], // 阈值-1
    [90, 'alerting'], // 阈值
    [97.99, 'alerting'],
    [98, 'exhausted'],
    [100, 'exhausted'],
  ];
  for (const [percent, expected] of cases) {
    test(`${percent}% → ${expected}`, () => {
      const r = resolvePetMood(input({ windows: [win('ark', 'five-hour', percent)] }));
      assert.equal(r.mood, expected);
      assert.equal(r.activeProvider, 'ark');
      assert.equal(r.activeWindow, 'five-hour');
      assert.equal(r.resetFiredKey, null);
    });
  }
});

describe('自定义 quotaAlertThreshold', () => {
  test('阈值 80：79.99% loaded，80% 直接 alerting（tense 带塌缩为空）', () => {
    assert.equal(
      resolvePetMood(input({ windows: [win('ark', 'five-hour', 79.99)], quotaAlertThreshold: 80 })).mood,
      'loaded',
    );
    assert.equal(
      resolvePetMood(input({ windows: [win('ark', 'five-hour', 80)], quotaAlertThreshold: 80 })).mood,
      'alerting',
    );
  });

  test('阈值 95：94% tense，95% alerting', () => {
    assert.equal(
      resolvePetMood(input({ windows: [win('ark', 'five-hour', 94)], quotaAlertThreshold: 95 })).mood,
      'tense',
    );
    assert.equal(
      resolvePetMood(input({ windows: [win('ark', 'five-hour', 95)], quotaAlertThreshold: 95 })).mood,
      'alerting',
    );
  });

  test('非法阈值（NaN/0/101/null）回退默认 90', () => {
    for (const bad of [Number.NaN, 0, 101, -5, null]) {
      const r = resolvePetMood(
        input({ windows: [win('ark', 'five-hour', 89)], quotaAlertThreshold: bad as number | null }),
      );
      assert.equal(r.mood, 'tense', `bad threshold ${String(bad)} should fall back to ${DEFAULT_PET_MOOD_ALERT_THRESHOLD}`);
    }
  });
});

describe('多窗口 / 多 provider 聚合', () => {
  test('同 provider：百分比优先于窗口短长（5h 55% 输给 monthly 60%）', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 55), win('ark', 'monthly', 60)],
    }));
    assert.equal(r.activeWindow, 'monthly');
    assert.equal(r.mood, 'loaded');
  });

  test('同 provider 同百分比：5h 优先于 weekly（短窗口剩余绝对额度更少）', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'weekly', 60), win('ark', 'five-hour', 60)],
    }));
    assert.equal(r.activeWindow, 'five-hour');
  });

  test('跨 provider：全局最高紧急度（ark monthly 95% 压过 codex 5h 60%）', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'monthly', 95), win('codex', 'five-hour', 60)],
    }));
    assert.equal(r.activeProvider, 'ark');
    assert.equal(r.activeWindow, 'monthly');
    assert.equal(r.mood, 'alerting');
  });

  test('跨 provider 同百分比同窗口：输入顺序稳定裁决', () => {
    const r = resolvePetMood(input({
      windows: [win('codex', 'five-hour', 80), win('ark', 'five-hour', 80)],
    }));
    assert.equal(r.activeProvider, 'codex');
  });

  test('跨 provider：80% 的 5h 在并列时压过 80% 的 monthly（短窗口优先）', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'monthly', 80), win('codex', 'five-hour', 80)],
    }));
    assert.equal(r.activeProvider, 'codex');
    assert.equal(r.activeWindow, 'five-hour');
    assert.equal(r.mood, 'tense');
  });
});

describe('unknown：没数据 ≠ 耗尽', () => {
  test('status 非 ready → unknown 且不标 provider', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 100)],
      status: 'temporarily-unavailable',
    }));
    assert.deepEqual(r, { mood: 'unknown', activeProvider: null, activeWindow: null, resetFiredKey: null });
  });

  test('stale → unknown（即使 100% 也不能演成 exhausted）', () => {
    const r = resolvePetMood(input({ windows: [win('ark', 'five-hour', 100)], stale: true }));
    assert.equal(r.mood, 'unknown');
  });

  test('windows 空 → unknown', () => {
    assert.equal(resolvePetMood(input()).mood, 'unknown');
  });

  test('窗口全部非法（NaN）→ unknown', () => {
    const r = resolvePetMood(input({ windows: [win('ark', 'five-hour', Number.NaN)] }));
    assert.equal(r.mood, 'unknown');
    assert.equal(r.activeProvider, null);
  });
});

describe('reset 边沿（仅最紧窗口、每 resetsAt 一次）', () => {
  test('未到重置点：不触发，按百分比给 mood', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, 2_000)],
      nowSec: 1_999,
    }));
    assert.equal(r.mood, 'healthy');
    assert.equal(r.resetFiredKey, null);
  });

  test('nowSec == resetsAt 即视为跨过：边沿触发 resetting + key', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, 1_000)],
      nowSec: 1_000,
    }));
    assert.equal(r.mood, 'resetting');
    assert.equal(r.resetFiredKey, 'ark:five-hour:1000');
    assert.equal(r.activeProvider, 'ark');
    assert.equal(r.activeWindow, 'five-hour');
  });

  test('同一 resetsAt 连续第二次评估：不重复触发，回到百分比 mood', () => {
    const first = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, 1_000)],
      nowSec: 1_000,
    }));
    const second = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, 1_000)],
      nowSec: 1_060,
      lastResetFireKey: first.resetFiredKey,
    }));
    assert.equal(first.resetFiredKey, 'ark:five-hour:1000');
    assert.equal(second.mood, 'healthy');
    assert.equal(second.resetFiredKey, null);
  });

  test('新 resetsAt（下一周期）再次跨过：重新触发，key 不同', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, 2_000)],
      nowSec: 2_000,
      lastResetFireKey: 'ark:five-hour:1000',
    }));
    assert.equal(r.mood, 'resetting');
    assert.equal(r.resetFiredKey, 'ark:five-hour:2000');
  });

  test('resetsAt=null：永不触发', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, null)],
      nowSec: 9_999_999,
    }));
    assert.equal(r.mood, 'healthy');
    assert.equal(r.resetFiredKey, null);
  });

  test('只看全局最紧窗口：非最紧窗口跨过不触发（5h 99% 时 monthly 重置是噪声）', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 99, null), win('ark', 'monthly', 20, 1_000)],
      nowSec: 1_000,
    }));
    assert.equal(r.activeWindow, 'five-hour');
    assert.equal(r.mood, 'exhausted');
    assert.equal(r.resetFiredKey, null);
  });

  test('最紧窗口自身跨过：触发（monthly 95% 是当前情绪驱动窗口）', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 30, null), win('ark', 'monthly', 95, 1_000)],
      nowSec: 1_000,
    }));
    assert.equal(r.mood, 'resetting');
    assert.equal(r.resetFiredKey, 'ark:monthly:1000');
  });

  test('unknown 期间跨过不触发也不消费边沿：fresh 后同一重置点仍可演出', () => {
    const stale = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, 1_000)],
      nowSec: 1_000,
      stale: true,
    }));
    assert.equal(stale.mood, 'unknown');
    assert.equal(stale.resetFiredKey, null);
    const fresh = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, 1_000)],
      nowSec: 1_000,
      lastResetFireKey: null,
    }));
    assert.equal(fresh.mood, 'resetting');
    assert.equal(fresh.resetFiredKey, 'ark:five-hour:1000');
  });
});

describe('reset 边沿与 exhausted/alerting 的优先级', () => {
  test('决策：边沿优先一帧——最紧窗口 100% 且重置点刚跨过 → resetting', () => {
    const crossing = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 100, 1_000)],
      nowSec: 1_000,
    }));
    assert.equal(crossing.mood, 'resetting');
    assert.equal(crossing.resetFiredKey, 'ark:five-hour:1000');
  });

  test('下一帧（key 已回传）：闪光结束即回落到 exhausted，不被吞掉', () => {
    const settled = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 100, 1_000)],
      nowSec: 1_060,
      lastResetFireKey: 'ark:five-hour:1000',
    }));
    assert.equal(settled.mood, 'exhausted');
    assert.equal(settled.resetFiredKey, null);
  });

  test('同规则适用于 alerting：90% 跨过 → resetting，下一帧 → alerting', () => {
    const crossing = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 90, 1_000)],
      nowSec: 1_000,
    }));
    const settled = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 90, 1_000)],
      nowSec: 1_060,
      lastResetFireKey: 'ark:five-hour:1000',
    }));
    assert.equal(crossing.mood, 'resetting');
    assert.equal(settled.mood, 'alerting');
  });

  test('真实回落语义：跨过后快照报低百分比，下一帧直接 healthy', () => {
    const settled = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 3, 1_000)],
      nowSec: 1_060,
      lastResetFireKey: 'ark:five-hour:1000',
    }));
    assert.equal(settled.mood, 'healthy');
  });
});

describe('非法输入确定性', () => {
  test('NaN 窗口丢弃，其余窗口继续参与判定', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', Number.NaN), win('ark', 'monthly', 70)],
    }));
    assert.equal(r.activeWindow, 'monthly');
    assert.equal(r.mood, 'loaded');
  });

  test('Infinity / -Infinity 丢弃', () => {
    const r = resolvePetMood(input({
      windows: [
        win('ark', 'five-hour', Number.POSITIVE_INFINITY),
        win('ark', 'weekly', Number.NEGATIVE_INFINITY),
        win('ark', 'monthly', 50),
      ],
    }));
    assert.equal(r.activeWindow, 'monthly');
    assert.equal(r.mood, 'healthy');
  });

  test('有限越界 percent clamp：-5 → 0（healthy），130 → 100（exhausted）', () => {
    assert.equal(resolvePetMood(input({ windows: [win('ark', 'five-hour', -5)] })).mood, 'healthy');
    assert.equal(resolvePetMood(input({ windows: [win('ark', 'five-hour', 130)] })).mood, 'exhausted');
  });

  test('非法 id 丢弃（联合类型外的运行时脏数据）', () => {
    const bad = { provider: 'ark', id: 'daily', usedPercent: 99, resetsAt: null } as unknown as MoodInputWindow;
    assert.equal(resolvePetMood(input({ windows: [bad] })).mood, 'unknown');
    const mixed = resolvePetMood(input({
      windows: [bad, win('ark', 'monthly', 65)],
    }));
    assert.equal(mixed.activeWindow, 'monthly');
    assert.equal(mixed.mood, 'loaded');
  });

  test('provider 空串/非字符串丢弃', () => {
    const empty = win('', 'five-hour', 99);
    const num = { provider: 42, id: 'five-hour', usedPercent: 99, resetsAt: null } as unknown as MoodInputWindow;
    assert.equal(resolvePetMood(input({ windows: [empty, num] })).mood, 'unknown');
  });

  test('resetsAt 非有限值按 null 处理：不触发边沿', () => {
    const r = resolvePetMood(input({
      windows: [win('ark', 'five-hour', 5, Number.NaN)],
      nowSec: 9_999_999,
    }));
    assert.equal(r.mood, 'healthy');
    assert.equal(r.resetFiredKey, null);
  });

  test('nowSec 非有限数：抛 RangeError（调用方 bug，不静默）', () => {
    assert.throws(
      () => resolvePetMood(input({ nowSec: Number.NaN })),
      RangeError,
    );
  });

  test('windows 非数组：抛 TypeError', () => {
    assert.throws(
      () => resolvePetMood(input({ windows: null as unknown as MoodInputWindow[] })),
      TypeError,
    );
  });
});
