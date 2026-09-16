// SPDX-License-Identifier: MIT
// shared/ark-token-packs.test.ts -- 免费推理额度折叠/汇总纯逻辑测试（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArkTokenPack } from './ark-subscription';
import {
  COLLAPSE_MODEL_THRESHOLD,
  TOKEN_PACKS_SOURCE_TOOLTIP,
  countArkTokenModels,
  formatArkTokenCount,
  shouldCollapseTokenPacks,
  summarizeArkTokenPacks,
} from './ark-token-packs';

function pack(partial: Partial<ArkTokenPack> & { total: number; consumed: number }): ArkTokenPack {
  const { total, consumed } = partial;
  return {
    model: partial.model ?? 'm',
    displayName: partial.displayName ?? 'M',
    label: partial.label ?? '免费额度',
    total,
    consumed,
    remaining: total - consumed,
    usedPercent: total > 0 ? Math.max(0, Math.min(100, (consumed / total) * 100)) : 0,
  };
}

test('TOKEN_PACKS_SOURCE_TOOLTIP: 用户口径，不暴露内部接口名/arkcli 字样', () => {
  assert.match(TOKEN_PACKS_SOURCE_TOOLTIP, /免费推理额度/);
  assert.match(TOKEN_PACKS_SOURCE_TOOLTIP, /协作奖励返还/);
  assert.match(TOKEN_PACKS_SOURCE_TOOLTIP, /不含付费/);
  for (const banned of ['ListModelChargeItems', 'ResourcePackItems', 'InferenceFreeUsage', 'FreeInference', 'arkcli']) {
    assert.ok(!TOKEN_PACKS_SOURCE_TOOLTIP.includes(banned), `tooltip 不应出现内部字样：${banned}`);
  }
});

test('summarizeArkTokenPacks: 多模型 token 直接相加（粗口径），模型数按 model 去重，百分比两位小数', () => {
  const s = summarizeArkTokenPacks([
    pack({ model: 'a', total: 1000, consumed: 250 }),
    pack({ model: 'b', total: 3000, consumed: 750 }),
  ]);
  assert.equal(s.modelCount, 2);
  assert.equal(s.total, 4000);
  assert.equal(s.totalConsumed, 1000);
  assert.equal(s.totalRemaining, 3000);
  assert.equal(s.usedPct, 25);
});

test('summarizeArkTokenPacks: remaining 可为负（过期降档），usedPct 不 clamp 可 >100', () => {
  const s = summarizeArkTokenPacks([
    pack({ total: 100, consumed: 120 }),
    pack({ total: 100, consumed: 30 }),
  ]);
  assert.equal(s.totalConsumed, 150);
  assert.equal(s.totalRemaining, 50); // 一行 -20、一行 +70，负余不 clamp，合计 50
  assert.equal(s.usedPct, 75);
  const overdue = summarizeArkTokenPacks([pack({ total: 100, consumed: 130 })]);
  assert.equal(overdue.totalRemaining, -30);
  assert.equal(overdue.usedPct, 130);
});

test('summarizeArkTokenPacks: total<=0 的池子跳过；全跳过 usedPct=null', () => {
  const s = summarizeArkTokenPacks([
    pack({ total: 0, consumed: 0 }),
    pack({ total: 100, consumed: 10 }),
  ]);
  assert.equal(s.total, 100);
  assert.equal(s.totalConsumed, 10);
  assert.equal(s.usedPct, 10);
  assert.equal(summarizeArkTokenPacks([]).usedPct, null);
});

test('shouldCollapseTokenPacks: 阈值 >=2 个去重模型，0/1 个模型不折叠', () => {
  assert.equal(COLLAPSE_MODEL_THRESHOLD, 2);
  assert.equal(shouldCollapseTokenPacks([]), false);
  assert.equal(shouldCollapseTokenPacks([{ model: 'm' }]), false);
  assert.equal(shouldCollapseTokenPacks([{ model: 'a' }, { model: 'b' }]), true);
  assert.equal(shouldCollapseTokenPacks(new Array(10).fill(0).map((_, i) => ({ model: `m${i}` }))), true);
});

test('formatArkTokenCount: 万/亿自适应 + 负数保留负号', () => {
  assert.equal(formatArkTokenCount(999), '999');
  assert.equal(formatArkTokenCount(12_345), '1.2万');
  assert.equal(formatArkTokenCount(200_000_000), '2亿');
  assert.equal(formatArkTokenCount(-3000), '-3000');
  assert.equal(formatArkTokenCount(-52_000), '-5.2万');
});

test('双池单模型（免费额度 + 资源包两行）：模型计数=1 且不折叠', () => {
  const packs = [
    pack({ model: 'doubao', label: '免费额度', total: 1000, consumed: 100 }),
    pack({ model: 'doubao', label: '资源包', total: 5000, consumed: 200 }),
  ];
  assert.equal(countArkTokenModels(packs), 1);
  assert.equal(summarizeArkTokenPacks(packs).modelCount, 1);
  assert.equal(shouldCollapseTokenPacks(packs), false);
});

test('双模型（各自单池）：模型计数=2 且折叠', () => {
  const packs = [
    pack({ model: 'doubao', total: 1000, consumed: 100 }),
    pack({ model: 'deepseek', total: 5000, consumed: 200 }),
  ];
  assert.equal(countArkTokenModels(packs), 2);
  assert.equal(shouldCollapseTokenPacks(packs), true);
});

test('汇总负值不 clamp：跨池负余额原样保留，usedPct 可超过 100 不截断', () => {
  const s = summarizeArkTokenPacks([
    pack({ model: 'a', total: 100, consumed: 130 }), // remaining -30
    pack({ model: 'b', total: 100, consumed: 30 }),
  ]);
  assert.equal(s.totalRemaining, 40);
  assert.equal(s.usedPct, 80);
  const allOverdue = summarizeArkTokenPacks([
    pack({ model: 'a', total: 100, consumed: 150 }),
    pack({ model: 'b', total: 100, consumed: 250 }),
  ]);
  assert.equal(allOverdue.totalRemaining, -200);
  assert.equal(allOverdue.usedPct, 200);
});
