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
  formatCompactBubbleRow,
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

const MIN = 60;
const HOUR = 3_600;
const NOW_SEC = NOW_MS / 1_000;

test('formatCompactBubbleRow: primaryLabel 恒显示（5h），planLabel 仅留给悬浮', () => {
  const row: ReturnType<typeof projectToCompactRows>[number] = {
    key: 'codex',
    title: 'Codex',
    planLabel: 'Pro',
    primaryLabel: '5h',
    remainingPercent: 42,
    resetsAtSec: NOW_SEC + 18 * MIN,
    stale: false,
    hasData: true,
  };
  const text = formatCompactBubbleRow(row, NOW_SEC);
  assert.equal(text.title, 'Codex');
  // planLabel 不进正文，但投影仍返回（渲染层拼 title 悬浮 `title · planLabel`）。
  assert.equal(text.planLabel, 'Pro');
  assert.equal(text.primaryLabel, '5h');
  assert.equal(text.remainingPercent, 42);
  // 短形态为 GMT+8 具体时刻（同天 HH:mm；fixture 17:46 + 18m = 18:04）。
  assert.equal(text.resetShort, '18:04');
  // 完整中文进 title 悬浮文案，含窗口名 + 「今天 HH:mm 重置」。
  assert.equal(text.resetTitle, '5h 窗口 今天 18:04 重置');
  assert.equal(
    text.ariaLabel,
    'Codex Pro 5h 窗口剩余 42%，今天 18:04 重置',
  );
});

test('formatCompactBubbleRow: primaryLabel 与 title 同名（归一化）时隐藏', () => {
  const row = {
    key: 'cursor' as const,
    title: 'Cursor',
    planLabel: 'Pro',
    primaryLabel: 'Cursor',
    remainingPercent: 20,
    resetsAtSec: null,
    stale: false,
    hasData: true,
  };
  const text = formatCompactBubbleRow(row, NOW_SEC);
  assert.equal(text.primaryLabel, null); // 消除 `Cursor · Cursor`
  assert.equal(text.resetShort, null);
  assert.equal(text.resetTitle, null);
  assert.equal(text.ariaLabel, 'Cursor Pro 剩余 20%');

  // trim + 小写归一：带空白 / 大小写差异同样视为同名。
  const spaced = formatCompactBubbleRow({ ...row, primaryLabel: ' cursor ' }, NOW_SEC);
  assert.equal(spaced.primaryLabel, null);
  // 同名但有重置点时 resetTitle 退化为不带窗口名的完整中文。
  const withReset = formatCompactBubbleRow(
    { ...row, resetsAtSec: NOW_SEC + 18 * MIN },
    NOW_SEC,
  );
  assert.equal(withReset.primaryLabel, null);
  assert.equal(withReset.resetShort, '18:04');
  assert.equal(withReset.resetTitle, '今天 18:04 重置');
  assert.equal(withReset.ariaLabel, 'Cursor Pro 剩余 20%，今天 18:04 重置');
});

test('formatCompactBubbleRow: 非 5h 主窗口保留窗口标签（7d/30d/Plan/Credits/余额/积分等）', () => {
  const row = {
    key: 'kimi' as const,
    title: 'Kimi Code',
    planLabel: null,
    primaryLabel: '7d',
    remainingPercent: 78,
    // fixture 17:46 + 1h45m = 同日 19:31（GMT+8）
    resetsAtSec: NOW_SEC + HOUR + 45 * MIN,
    stale: false,
    hasData: true,
  };
  const text = formatCompactBubbleRow(row, NOW_SEC);
  assert.equal(text.primaryLabel, '7d');
  assert.equal(text.resetShort, '19:31');
  assert.equal(text.resetTitle, '7d 窗口 今天 19:31 重置');
  assert.equal(
    text.ariaLabel,
    'Kimi Code 7d 窗口剩余 78%，今天 19:31 重置',
  );
});

test('formatCompactBubbleRow: 过期 / null / 0 重置点 → resetShort/resetTitle 为 null', () => {
  const expired = {
    key: 'grok' as const,
    title: 'Grok',
    planLabel: null,
    primaryLabel: '5h',
    remainingPercent: 80,
    resetsAtSec: NOW_SEC - 1, // 已过
    stale: false,
    hasData: true,
  };
  const text = formatCompactBubbleRow(expired, NOW_SEC);
  assert.equal(text.resetShort, null);
  assert.equal(text.resetTitle, null);
  // aria-label 不附「…分钟后重置」尾巴
  assert.equal(text.ariaLabel, 'Grok 5h 窗口剩余 80%');

  const nullReset = { ...expired, resetsAtSec: null };
  const t2 = formatCompactBubbleRow(nullReset, NOW_SEC);
  assert.equal(t2.resetShort, null);
  assert.equal(t2.ariaLabel, 'Grok 5h 窗口剩余 80%');
});

test('formatCompactBubbleRow: planLabel 空串归一为 null；stale 透传；无 plan 无双空格', () => {
  const withPlan = {
    key: 'ark' as const,
    title: '火山方舟 Agent Plan',
    planLabel: 'medium',
    primaryLabel: '5h',
    remainingPercent: 0,
    resetsAtSec: NOW_SEC + 18 * MIN,
    stale: true,
    hasData: true,
  };
  const text = formatCompactBubbleRow(withPlan, NOW_SEC);
  assert.equal(text.planLabel, 'medium'); // 仅悬浮用
  assert.equal(text.stale, true);
  assert.equal(text.resetShort, '18:04');
  // stale 只在模型层透传（mood/告警依赖）：气泡所有可见文案均不带
  // 「旧」「已过期」后缀（title / ariaLabel / resetTitle / planLabel）。
  for (const visible of [text.title, text.ariaLabel, text.resetTitle ?? '', text.planLabel ?? '']) {
    assert.equal(visible.includes('旧'), false, `unexpected 旧 in: ${visible}`);
    assert.equal(visible.includes('已过期'), false, `unexpected 已过期 in: ${visible}`);
  }

  const emptyPlan = formatCompactBubbleRow({ ...withPlan, planLabel: '   ' }, NOW_SEC);
  assert.equal(emptyPlan.planLabel, null);

  const noPlan = formatCompactBubbleRow({ ...withPlan, planLabel: null }, NOW_SEC);
  assert.equal(noPlan.planLabel, null);
  assert.equal(
    noPlan.ariaLabel,
    '火山方舟 Agent Plan 5h 窗口剩余 0%，今天 18:04 重置',
  );
});

test('formatCompactBubbleRow: 与 projectToCompactRows 端到端拼装可还原真实三连行', () => {
  // 真实典型三连：Cursor / 火山方舟 Agent Plan / Minimax CN
  const aggregate = buildPetQuotaAggregate(
    [
      // Cursor 无重置点、planLabel=Free、primary=Cursor（与 title 同名 → 隐藏）
      { provider: 'cursor', snapshot: {
        status: 'ready',
        planLabel: 'Free',
        cursorModels: { usedPercent: 100, resetsAt: null },
        otherModels: null,
        plan: null,
        fetchedAt: FUTURE_SEC,
        stale: false,
        message: null,
      } },
      // 火山方舟 Agent Plan 5h / 同日 18:04 重置
      { provider: 'ark', snapshot: arkFixture({
        planLabel: 'medium',
        limits: [
          { id: 'monthly', label: '30d', usedPercent: 5, resetsAt: FUTURE_SEC + 200 },
          { id: 'five-hour', label: '5h', usedPercent: 90, resetsAt: NOW_SEC + 18 * MIN },
          { id: 'weekly', label: '7d', usedPercent: 10, resetsAt: FUTURE_SEC + 100 },
        ],
      }) },
      // Minimax CN 5h / 同日 19:31 重置
      { provider: 'minimax', snapshot: {
        status: 'ready',
        planLabel: 'Coding Plan',
        region: 'mainland',
        limits: [{ id: 'five-hour', label: '5h', usedPercent: 9, resetsAt: NOW_SEC + HOUR + 45 * MIN }],
        fetchedAt: FUTURE_SEC,
        stale: false,
        message: null,
      } },
    ],
    NOW_MS,
  );
  const rows = projectToCompactRows(aggregate);
  const texts = rows.map((row) => formatCompactBubbleRow(row, NOW_SEC));
  // Cursor：0% 剩余，同名窗口标签隐藏，无重置 → 纯数字行
  const cursor = texts.find((t) => t.title === 'Cursor');
  assert.ok(cursor);
  assert.equal(cursor!.planLabel, 'Free');
  assert.equal(cursor!.primaryLabel, null);
  assert.equal(cursor!.resetShort, null);
  assert.equal(cursor!.remainingPercent, 0);
  // 火山方舟：5h 恒显、18:04 短形态
  const ark = texts.find((t) => t.title === '火山方舟 Agent Plan');
  assert.ok(ark);
  assert.equal(ark!.planLabel, 'medium');
  assert.equal(ark!.primaryLabel, '5h');
  assert.equal(ark!.resetShort, '18:04');
  assert.equal(ark!.remainingPercent, 10);
  // Minimax CN：19:31 短形态、5h 恒显
  const cn = texts.find((t) => t.title === 'Minimax CN');
  assert.ok(cn);
  assert.equal(cn!.primaryLabel, '5h');
  assert.equal(cn!.resetShort, '19:31');
  assert.equal(cn!.remainingPercent, 91);
  // resetTitle 始终含窗口名保悬浮可读
  assert.equal(ark!.resetTitle, '5h 窗口 今天 18:04 重置');
  assert.equal(cn!.resetTitle, '5h 窗口 今天 19:31 重置');
});
