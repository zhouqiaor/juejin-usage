// SPDX-License-Identifier: MIT
// shared/pet-quota-integration.test.ts — 宠物视图集成归一化纯逻辑测试（node:test）
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ArkSubscriptionSnapshot } from './ark-subscription.js';
import type { PetQuotaAggregate } from './pet-quota-providers.js';
import {
  ARK_PROVIDER,
  aggregateToQuotaWindows,
  arkSnapshotToQuotaWindows,
} from './pet-quota-integration.js';

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
