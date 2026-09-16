// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArkSubscriptionSnapshot } from './ark-subscription.js';
import type { ClaudeSubscriptionSnapshot } from './claude-subscription.js';
import type { CodexSubscriptionSnapshot } from './codex-subscription.js';
import type { CursorSubscriptionSnapshot } from './cursor-subscription.js';
import type { DeepSeekSubscriptionSnapshot } from './deepseek-subscription.js';
import type { MiniMaxSubscriptionSnapshot } from './minimax-subscription.js';
import type { TraeSubscriptionSnapshot } from './trae-subscription.js';
import type { WorkBuddySubscriptionSnapshot } from './workbuddy-subscription.js';
import {
  buildPetQuotaAggregate,
  classifyQuotaWindow,
  normalizeAntigravitySection,
  normalizeArkSection,
  normalizeClaudeSection,
  normalizeCodexSection,
  normalizeCursorSection,
  normalizeDeepSeekSection,
  normalizeMiniMaxSection,
  normalizeProviderEntry,
  normalizeTraeSection,
  normalizeWorkBuddySection,
  orderProviderWindows,
  projectToCompactRows,
  type PetProviderSnapshotEntry,
} from './pet-quota-providers.js';

const NOW_MS = 100_000_000_000;
const FUTURE_SEC = NOW_MS / 1000 + 3600;
const PAST_SEC = NOW_MS / 1000 - 3600;

function codexFixture(overrides: Partial<CodexSubscriptionSnapshot> = {}): CodexSubscriptionSnapshot {
  return {
    status: 'ready',
    planLabel: 'Pro',
    fiveHour: { usedPercent: 10, resetsAt: FUTURE_SEC },
    weekly: { usedPercent: 30, resetsAt: FUTURE_SEC + 100 },
    message: null,
    ...overrides,
  };
}

test('classifyQuotaWindow 按 id 优先，其次 label 文本', () => {
  assert.equal(classifyQuotaWindow('five-hour', '5h'), 'five-hour');
  assert.equal(classifyQuotaWindow('weekly', '7d'), 'weekly');
  assert.equal(classifyQuotaWindow('monthly', '30d'), 'monthly');
  assert.equal(classifyQuotaWindow('session', '3h 会话'), 'other');
  assert.equal(classifyQuotaWindow('xxx', '5小时窗口'), 'five-hour');
  assert.equal(classifyQuotaWindow('xxx', '周额度'), 'weekly');
  assert.equal(classifyQuotaWindow('xxx', '月度'), 'monthly');
  assert.equal(classifyQuotaWindow('balance-cny', '余额'), 'other');
});

test('orderProviderWindows: 5h→7d→30d→other 稳定排序并截断到 3 个', () => {
  const windows = orderProviderWindows([
    { id: 'monthly', label: '30d', usedPercent: 1, resetsAtSec: null },
    { id: 'five-hour', label: '5h', usedPercent: 2, resetsAtSec: null },
    { id: 'mcp', label: 'MCP', usedPercent: 3, resetsAtSec: null },
    { id: 'weekly', label: '7d', usedPercent: 4, resetsAtSec: null },
  ]);
  assert.deepEqual(windows.map((w) => w.id), ['five-hour', 'weekly', 'monthly']);
});

test('orderProviderWindows: sortOtherByUsage 让无 5h provider 的最紧张窗口排第一', () => {
  const windows = orderProviderWindows([
    { id: 'a', label: 'A', usedPercent: 10, resetsAtSec: null },
    { id: 'b', label: 'B', usedPercent: 80, resetsAtSec: null },
    { id: 'c', label: 'C', usedPercent: 40, resetsAtSec: null },
    { id: 'd', label: 'D', usedPercent: 9, resetsAtSec: null },
  ], { sortOtherByUsage: true });
  assert.deepEqual(windows.map((w) => w.usedPercent), [80, 40, 10]);
});

test('非 ready 状态一律归一化为 null（未配置/未登录/失败不渲染区块）', () => {
  assert.equal(normalizeCodexSection(codexFixture({ status: 'not-signed-in' })), null);
  assert.equal(normalizeCodexSection(codexFixture({
    status: 'ready',
    fiveHour: null,
    weekly: null,
  })), null);
});

test('Codex: 5h 为重点窗口，标签固定 5h/7d', () => {
  const section = normalizeCodexSection(codexFixture());
  assert.ok(section);
  assert.equal(section!.title, 'Codex');
  assert.deepEqual(section!.windows.map((w) => w.label), ['5h', '7d']);
  assert.equal(section!.primary.kind, 'five-hour');
  assert.equal(section!.primary.usedPercent, 10);
  assert.equal(section!.tightestPack, null);
});

test('Claude: stale 透传，sevenDay 归一为 weekly', () => {
  const snapshot: ClaudeSubscriptionSnapshot = {
    status: 'ready',
    planLabel: 'Pro',
    fiveHour: { usedPercent: 90, resetsAt: FUTURE_SEC },
    sevenDay: { usedPercent: 20, resetsAt: null },
    fetchedAt: FUTURE_SEC,
    stale: true,
    message: null,
  };
  const section = normalizeClaudeSection(snapshot);
  assert.ok(section);
  assert.equal(section!.stale, true);
  assert.equal(section!.windows[1]?.kind, 'weekly');
});

test('Cursor: 无时间窗口时最紧张模型桶成为重点行', () => {
  const snapshot: CursorSubscriptionSnapshot = {
    status: 'ready',
    planLabel: 'Pro',
    cursorModels: { usedPercent: 80, resetsAt: null },
    otherModels: { usedPercent: 40, resetsAt: null },
    plan: { usedPercent: 5, resetsAt: null },
    fetchedAt: FUTURE_SEC,
    stale: false,
    message: null,
  };
  const section = normalizeCursorSection(snapshot);
  assert.ok(section);
  assert.equal(section!.primary.id, 'cursor-models');
  assert.equal(section!.primary.usedPercent, 80);
});

test('Gemini: 去掉 gemini 前缀、按已用降序、最多 3 个窗口', () => {
  const section = normalizeAntigravitySection({
    status: 'ready',
    planLabel: null,
    limits: [
      { id: 'm1', label: 'gemini 2.5 pro', usedPercent: 10, resetsAt: null },
      { id: 'm2', label: 'gemini flash', usedPercent: 70, resetsAt: null },
      { id: 'm3', label: 'gemini lite', usedPercent: 30, resetsAt: null },
      { id: 'm4', label: 'other', usedPercent: 5, resetsAt: null },
    ],
    fetchedAt: FUTURE_SEC,
    stale: false,
    message: null,
  });
  assert.ok(section);
  assert.deepEqual(section!.windows.map((w) => w.label), ['flash', 'lite', '2.5 pro']);
});

function arkFixture(overrides: Partial<ArkSubscriptionSnapshot> = {}): ArkSubscriptionSnapshot {
  return {
    status: 'ready',
    planKind: 'agent',
    planLabel: 'Pro',
    limits: [
      { id: 'monthly', label: '30d', usedPercent: 5, resetsAt: FUTURE_SEC + 200 },
      { id: 'five-hour', label: '5h', usedPercent: 90, resetsAt: FUTURE_SEC },
      { id: 'weekly', label: '7d', usedPercent: 10, resetsAt: FUTURE_SEC + 100 },
    ],
    tokenPacks: [
      {
        model: 'doubao-a',
        displayName: '豆包 A',
        label: '免费额度',
        total: 100,
        consumed: 20,
        remaining: 80,
        usedPercent: 20,
      },
      {
        model: 'doubao-b',
        displayName: '豆包 B',
        label: '资源包',
        total: 100,
        consumed: 90,
        remaining: 10,
        usedPercent: 90,
      },
    ],
    tokenPacksError: null,
    fetchedAt: FUTURE_SEC,
    stale: false,
    message: null,
    ...overrides,
  };
}

test('Ark Agent Plan: 标题取自 arkPlanTitle，5h 第一，tokenPacks 折叠为最紧张一池', () => {
  const section = normalizeArkSection(arkFixture());
  assert.ok(section);
  assert.equal(section!.title, '火山方舟 Agent Plan');
  assert.deepEqual(section!.windows.map((w) => w.id), ['five-hour', 'weekly', 'monthly']);
  assert.equal(section!.primary.usedPercent, 90);
  assert.equal(section!.tightestPack?.displayName, '豆包 B');
  assert.equal(section!.tightestPack?.remaining, 10);
});

test('Ark: 无 limits 只有 tokenPacks 的账号在宠物气泡不渲染区块（空间有限）', () => {
  const section = normalizeArkSection(arkFixture({ limits: [] }));
  assert.equal(section, null);
});

test('Ark: 非 ready（未配置/鉴权失败）返回 null，tokenPacks 也不展示', () => {
  assert.equal(normalizeArkSection(arkFixture({ status: 'not-configured' })), null);
  assert.equal(normalizeArkSection(arkFixture({ status: 'auth-error' })), null);
});

test('MiniMax: region 决定标题 Minimax / Minimax CN', () => {
  const base: MiniMaxSubscriptionSnapshot = {
    status: 'ready',
    planLabel: 'Coding Plan',
    region: 'global',
    limits: [{ id: 'five-hour', label: '5h', usedPercent: 12, resetsAt: null }],
    fetchedAt: FUTURE_SEC,
    stale: false,
    message: null,
  };
  assert.equal(normalizeMiniMaxSection(base)?.title, 'Minimax');
  assert.equal(normalizeMiniMaxSection({ ...base, region: 'mainland' })?.title, 'Minimax CN');
});

test('DeepSeek: 余额窗口带 detail 文本，无时间窗口也可成区块', () => {
  const snapshot: DeepSeekSubscriptionSnapshot = {
    status: 'ready',
    planLabel: null,
    limits: [{
      id: 'balance-cny',
      label: '余额',
      usedPercent: 33,
      description: '余额 ¥6.66 / ¥10.00',
      remaining: 6.66,
      total: 10,
      resetsAt: null,
    }],
    fetchedAt: FUTURE_SEC,
    stale: false,
    message: null,
  };
  const section = normalizeDeepSeekSection(snapshot);
  assert.ok(section);
  assert.equal(section!.primary.detail, '余额 ¥6.66 / ¥10.00');
});

test('Trae/WorkBuddy: 区后缀决定 provider key 与标题；WorkBuddy 大陆标签中文化', () => {
  const trae: TraeSubscriptionSnapshot = {
    status: 'ready',
    planLabel: null,
    region: 'global',
    limits: [{ id: 'basic', label: 'Basic', usedPercent: 50, resetsAt: null }],
    fetchedAt: FUTURE_SEC,
    stale: false,
    message: null,
  };
  assert.equal(normalizeTraeSection('trae-global', trae)?.title, 'TRAE');
  assert.equal(normalizeTraeSection('trae-cn', { ...trae, region: 'mainland' })?.title, 'TRAE CN');

  const wb: WorkBuddySubscriptionSnapshot = {
    status: 'ready',
    planLabel: null,
    region: 'mainland',
    limits: [{ id: 'credits', label: 'credits', usedPercent: 50, resetsAt: null }],
    fetchedAt: FUTURE_SEC,
    stale: false,
    message: null,
  };
  const wbCn = normalizeWorkBuddySection('workbuddy-mainland', wb);
  assert.equal(wbCn?.title, 'Workbuddy CN');
  assert.equal(wbCn?.primary.label, '积分');
  const wbGlobal = normalizeWorkBuddySection('workbuddy-global', { ...wb, region: 'global' });
  assert.equal(wbGlobal?.title, 'Workbuddy');
  assert.equal(wbGlobal?.primary.label, 'Credits');
});

test('buildPetQuotaAggregate: 跳过无数据家、按重点窗口已用降序稳定排序', () => {
  const entries: PetProviderSnapshotEntry[] = [
    { provider: 'codex', snapshot: codexFixture() }, // 5h 10%
    { provider: 'codex', snapshot: codexFixture({ status: 'not-signed-in' }) },
    {
      provider: 'claude',
      snapshot: {
        status: 'ready',
        planLabel: null,
        fiveHour: { usedPercent: 90, resetsAt: null },
        sevenDay: null,
        fetchedAt: FUTURE_SEC,
        stale: false,
        message: null,
      },
    },
  ];
  const aggregate = buildPetQuotaAggregate(entries, NOW_MS);
  assert.deepEqual(aggregate.sections.map((s) => s.provider), ['claude', 'codex']);
});

test('buildPetQuotaAggregate: 同紧张度保持输入顺序（稳定排序）', () => {
  const entries: PetProviderSnapshotEntry[] = [
    { provider: 'kimi', snapshot: {
      status: 'ready', planLabel: null,
      limits: [{ id: 'five-hour', label: '5h', usedPercent: 50, resetsAt: null }],
      fetchedAt: FUTURE_SEC, stale: false, message: null,
    } },
    { provider: 'grok', snapshot: {
      status: 'ready', planLabel: null,
      limits: [{ id: 'five-hour', label: '5h', usedPercent: 50, resetsAt: null }],
      fetchedAt: FUTURE_SEC, stale: false, message: null,
    } },
  ];
  const aggregate = buildPetQuotaAggregate(entries, NOW_MS);
  assert.deepEqual(aggregate.sections.map((s) => s.provider), ['kimi', 'grok']);
});

test('buildPetQuotaAggregate: nextResetSec 取所有区块中最近的未来重置点，过期忽略', () => {
  const entries: PetProviderSnapshotEntry[] = [
    { provider: 'codex', snapshot: codexFixture({
      fiveHour: { usedPercent: 1, resetsAt: PAST_SEC },
      weekly: { usedPercent: 1, resetsAt: FUTURE_SEC + 500 },
    }) },
    { provider: 'claude', snapshot: {
      status: 'ready', planLabel: null,
      fiveHour: { usedPercent: 1, resetsAt: FUTURE_SEC },
      sevenDay: null,
      fetchedAt: FUTURE_SEC, stale: false, message: null,
    } },
  ];
  const aggregate = buildPetQuotaAggregate(entries, NOW_MS);
  assert.equal(aggregate.nextResetSec, FUTURE_SEC);
});

test('全部 provider 无有效数据时聚合为空（额度区整体不渲染）', () => {
  const aggregate = buildPetQuotaAggregate([], NOW_MS);
  assert.deepEqual(aggregate.sections, []);
  assert.equal(aggregate.nextResetSec, null);
});

test('normalizeProviderEntry 按 key 分发到对应 mapper', () => {
  const entry: PetProviderSnapshotEntry = { provider: 'codex', snapshot: codexFixture() };
  assert.equal(normalizeProviderEntry(entry)?.provider, 'codex');
});

test('projectToCompactRows: 有 5h 时取 5h，label 为 5h', () => {
  const aggregate = buildPetQuotaAggregate(
    [{ provider: 'codex', snapshot: codexFixture({ fiveHour: { usedPercent: 58, resetsAt: FUTURE_SEC } }) }],
    NOW_MS,
  );
  const rows = projectToCompactRows(aggregate);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    key: 'codex',
    title: 'Codex',
    planLabel: 'Pro',
    primaryLabel: '5h',
    remainingPercent: 42,
    resetsAtSec: FUTURE_SEC,
    stale: false,
    hasData: true,
  });
});

test('projectToCompactRows: 无 5h 退化到已用最高窗口（Cursor 模型桶）', () => {
  const aggregate = buildPetQuotaAggregate(
    [{
      provider: 'cursor',
      snapshot: {
        status: 'ready',
        planLabel: 'Pro',
        cursorModels: { usedPercent: 80, resetsAt: null },
        otherModels: { usedPercent: 40, resetsAt: null },
        plan: { usedPercent: 5, resetsAt: null },
        fetchedAt: FUTURE_SEC,
        stale: false,
        message: null,
      },
    }],
    NOW_MS,
  );
  const rows = projectToCompactRows(aggregate);
  assert.equal(rows[0]?.primaryLabel, 'Cursor');
  assert.equal(rows[0]?.remainingPercent, 20);
});

test('projectToCompactRows: 剩余是已用的补数且为整数，不二次换算', () => {
  const section = normalizeClaudeSection({
    status: 'ready',
    planLabel: null,
    fiveHour: { usedPercent: 33.4, resetsAt: null },
    sevenDay: null,
    fetchedAt: FUTURE_SEC,
    stale: false,
    message: null,
  })!;
  const rows = projectToCompactRows({ sections: [section], nextResetSec: null });
  assert.equal(rows[0]?.remainingPercent, 67);
});

test('projectToCompactRows: 按剩余升序（最危险在前），同值保持原序', () => {
  const entries: PetProviderSnapshotEntry[] = [
    { provider: 'codex', snapshot: codexFixture({ fiveHour: { usedPercent: 10, resetsAt: null } }) }, // 剩 90
    {
      provider: 'claude',
      snapshot: {
        status: 'ready', planLabel: null,
        fiveHour: { usedPercent: 90, resetsAt: null },
        sevenDay: null,
        fetchedAt: FUTURE_SEC, stale: false, message: null,
      },
    }, // 剩 10
    {
      provider: 'kimi',
      snapshot: {
        status: 'ready', planLabel: null,
        limits: [{ id: 'five-hour', label: '5h', usedPercent: 10, resetsAt: null }],
        fetchedAt: FUTURE_SEC, stale: false, message: null,
      },
    }, // 剩 90
  ];
  const rows = projectToCompactRows(buildPetQuotaAggregate(entries, NOW_MS));
  assert.deepEqual(rows.map((r) => r.key), ['claude', 'codex', 'kimi']);
  assert.deepEqual(rows.map((r) => r.remainingPercent), [10, 90, 90]);
});

test('projectToCompactRows: stale 透传；无数据家被跳过；16 家全空返回空数组', () => {
  const stale = normalizeClaudeSection({
    status: 'ready',
    planLabel: null,
    fiveHour: { usedPercent: 1, resetsAt: null },
    sevenDay: null,
    fetchedAt: FUTURE_SEC,
    stale: true,
    message: null,
  })!;
  const rows = projectToCompactRows({ sections: [stale], nextResetSec: null });
  assert.equal(rows[0]?.stale, true);
  assert.equal(rows[0]?.hasData, true);

  assert.deepEqual(projectToCompactRows(buildPetQuotaAggregate([], NOW_MS)), []);
});
