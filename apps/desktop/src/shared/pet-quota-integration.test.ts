// SPDX-License-Identifier: MIT
// shared/pet-quota-integration.test.ts — 宠物视图集成归一化纯逻辑测试（node:test）
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ArkSubscriptionSnapshot } from './ark-subscription.js';
import type {
  PetQuotaAggregate,
  PetQuotaProviderSection,
  PetQuotaWindow,
} from './pet-quota-providers.js';
import {
  ARK_PROVIDER,
  aggregateToMoodInput,
  aggregateToQuotaWindows,
  arkSnapshotToQuotaWindows,
} from './pet-quota-integration.js';

function makeWindow(
  kind: PetQuotaWindow['kind'],
  usedPercent = 0,
  resetsAtSec: number | null = null,
  id: string = kind,
): PetQuotaWindow {
  return { id, label: id, kind, usedPercent, resetsAtSec, detail: null };
}

function makeSection(
  provider: PetQuotaProviderSection['provider'],
  windows: PetQuotaWindow[],
  stale = false,
): PetQuotaProviderSection {
  return {
    provider,
    title: provider,
    planLabel: null,
    stale,
    windows,
    // mapper 不读 primary；空窗 section 在真实归一化层不会出现。
    primary: windows[0] as PetQuotaWindow,
    tightestPack: null,
  };
}

function makeAggregate(sections: PetQuotaAggregate['sections']): PetQuotaAggregate {
  return { nextResetSec: null, sections };
}

function snapshot(
  limits: ArkSubscriptionSnapshot['limits'],
): ArkSubscriptionSnapshot {
  return {
    status: 'ready',
    planLabel: null,
    limits,
    tokenPacks: [],
    tokenPacksError: null,
    fetchedAt: null,
    stale: false,
    message: null,
  };
}

test('空快照映射为空数组', () => {
  assert.deepEqual(arkSnapshotToQuotaWindows(snapshot([])), []);
});

test('limits 归一化为 ark provider 的 QuotaWindow，保留 id/percent', () => {
  const windows = arkSnapshotToQuotaWindows(
    snapshot([
      { id: 'five-hour', label: '5h', usedPercent: 92, resetsAt: null },
      { id: 'weekly', label: '7d', usedPercent: 55.5, resetsAt: 1_800_000_000 },
    ]),
  );
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], {
    provider: ARK_PROVIDER,
    id: 'five-hour',
    usedPercent: 92,
    resetsAt: null,
  });
  assert.deepEqual(windows[1], {
    provider: ARK_PROVIDER,
    id: 'weekly',
    usedPercent: 55.5,
    // epoch 秒 → 毫秒
    resetsAt: 1_800_000_000_000,
  });
});

test('非有限 resetsAt 归一化为 null（不泄露 NaN 进状态机）', () => {
  const windows = arkSnapshotToQuotaWindows(
    snapshot([
      { id: 'monthly', label: '30d', usedPercent: 10, resetsAt: Number.NaN },
    ]),
  );
  assert.equal(windows[0]?.resetsAt, null);
});

test('aggregateToQuotaWindows 展平多 provider，key 带区不碰撞，秒→毫秒', () => {
  const aggregate: PetQuotaAggregate = {
    nextResetSec: null,
    sections: [
      {
        provider: 'trae-cn',
        title: 'TRAE CN',
        planLabel: null,
        stale: false,
        windows: [
          { id: 'basic', label: 'Basic', kind: 'other', usedPercent: 40, resetsAtSec: 1_800_000_000, detail: null },
        ],
        primary: { id: 'basic', label: 'Basic', kind: 'other', usedPercent: 40, resetsAtSec: 1_800_000_000, detail: null },
        tightestPack: null,
      },
      {
        provider: 'ark',
        title: '火山方舟',
        planLabel: null,
        stale: true,
        windows: [
          { id: 'five-hour', label: '5h', kind: 'five-hour', usedPercent: 9, resetsAtSec: null, detail: null },
        ],
        primary: { id: 'five-hour', label: '5h', kind: 'five-hour', usedPercent: 9, resetsAtSec: null, detail: null },
        tightestPack: null,
      },
    ],
  };
  const windows = aggregateToQuotaWindows(aggregate);
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], {
    provider: 'trae-cn',
    id: 'basic',
    usedPercent: 40,
    resetsAt: 1_800_000_000_000,
  });
  assert.equal(windows[1]?.provider, ARK_PROVIDER);
  assert.equal(windows[1]?.resetsAt, null);
});

test('aggregateToMoodInput 默认只取 Ark section，其他 provider 被过滤', () => {
  const input = aggregateToMoodInput(
    makeAggregate([
      makeSection('trae-cn', [makeWindow('other', 40, 1_800_000_000, 'basic')]),
      makeSection('ark', [makeWindow('five-hour', 92)]),
      makeSection('minimax', [makeWindow('weekly', 30)]),
    ]),
  );
  assert.equal(input.status, 'ready');
  assert.equal(input.stale, false);
  assert.deepEqual(input.windows, [
    { provider: ARK_PROVIDER, id: 'five-hour', usedPercent: 92, resetsAt: null },
  ]);
});

test('aggregateToMoodInput 丢弃 other 窗口，仅映射 5h/weekly/monthly', () => {
  const input = aggregateToMoodInput(
    makeAggregate([
      makeSection('ark', [
        makeWindow('five-hour', 92),
        makeWindow('weekly', 55),
        makeWindow('monthly', 12),
        makeWindow('other', 77, null, 'plan'),
      ]),
    ]),
  );
  assert.deepEqual(input.windows.map((w) => w.id), ['five-hour', 'weekly', 'monthly']);
});

test('aggregateToMoodInput 空 aggregate 合成 not-configured（→ pet-mood unknown）', () => {
  const input = aggregateToMoodInput(makeAggregate([]));
  assert.deepEqual(input, { status: 'not-configured', stale: false, windows: [] });
  // 显式空 providers 等价于无 section。
  const empty = aggregateToMoodInput(
    makeAggregate([makeSection('ark', [makeWindow('five-hour', 10)])]),
    [],
  );
  assert.equal(empty.status, 'not-configured');
  assert.equal(empty.stale, false);
  assert.deepEqual(empty.windows, []);
});

test('aggregateToMoodInput stale = 过滤后全部 section 皆 stale，有任一 fresh 即 false', () => {
  const allStale = aggregateToMoodInput(
    makeAggregate([makeSection('ark', [makeWindow('five-hour', 9)], true)]),
  );
  assert.equal(allStale.status, 'ready');
  assert.equal(allStale.stale, true);

  const mixed = aggregateToMoodInput(
    makeAggregate([
      makeSection('ark', [makeWindow('five-hour', 9)], false),
      makeSection('trae-cn', [makeWindow('weekly', 80)], true),
    ]),
    [ARK_PROVIDER, 'trae-cn'],
  );
  assert.equal(mixed.stale, false);

  // 被过滤掉的 provider 不计入 stale：只有 Ark 时，别家 stale 与我无关。
  const arkFreshOthersStale = aggregateToMoodInput(
    makeAggregate([
      makeSection('ark', [makeWindow('five-hour', 9)], false),
      makeSection('minimax', [makeWindow('weekly', 80)], true),
    ]),
  );
  assert.equal(arkFreshOthersStale.stale, false);
});

test('aggregateToMoodInput 多窗口 id 取 kind，resetsAt 保持 epoch 秒不换算', () => {
  const input = aggregateToMoodInput(
    makeAggregate([
      makeSection('ark', [
        makeWindow('other', 66, 1_700_000_000, 'custom-id'),
        makeWindow('weekly', 55.5, 1_800_000_000),
      ]),
    ]),
  );
  assert.equal(input.windows.length, 1);
  assert.deepEqual(input.windows[0], {
    provider: ARK_PROVIDER,
    id: 'weekly',
    usedPercent: 55.5,
    // 秒原样透传（不是 aggregateToQuotaWindows 的毫秒）。
    resetsAt: 1_800_000_000,
  });
});

test('aggregateToMoodInput 返回全新对象，改输出不回灌 aggregate', () => {
  const sourceWindow = makeWindow('five-hour', 50, 1_800_000_000);
  const aggregate = makeAggregate([makeSection('ark', [sourceWindow])]);
  const input = aggregateToMoodInput(aggregate);
  assert.notEqual(input, aggregate);
  assert.notEqual(input.windows[0], sourceWindow);

  input.windows[0]!.usedPercent = 99;
  input.windows[0]!.resetsAt = 1;
  assert.equal(sourceWindow.usedPercent, 50);
  assert.equal(sourceWindow.resetsAtSec, 1_800_000_000);
  assert.equal(aggregate.sections[0]!.windows.length, 1);
});
