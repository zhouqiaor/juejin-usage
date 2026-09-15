// SPDX-License-Identifier: MIT
// renderer/lib/plan-balance-view.test.ts — 余量展示纯逻辑分层单测
//
// 模式：仿 src/main/*.test.ts（node:test + node:assert/strict）
// 范围：只测与 React 无关的纯函数（排序 / 标题 / 窗口选择 / 布局解析）。
//   组件渲染与 IPC 交互由人工验证清单 + E2E 覆盖（vendor 无 DOM 测试设施）。
// 安全护栏：这里特意断言纯逻辑「绝不重算 remaining_pct」，只挑选/排序，
//   防止后续有人在展示层引入 100-used 双算（HANDOVER §0 铁律 #1）。

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlanBalance, PlanWindow } from '../../shared/plan-balance';
import {
  DEFAULT_PLAN_BALANCE_LAYOUT,
  SEPARATE_GRID_CLASS,
  STATUS_LABEL,
  WINDOW_TABS,
  formatUpdatedAgo,
  hasWindowPct,
  otherWindows,
  planTitle,
  resolveLayout,
  selectWindow,
  sortBalances,
  usageTier,
  windowSemantic,
  windowTone,
} from './plan-balance-view';

function win(over: Partial<PlanWindow> = {}): PlanWindow {
  return {
    window: 'five_hour',
    window_label: '5 小时窗口',
    used_pct: 40,
    remaining_pct: 60,
    resets_at: '2026-09-15 17:00:00',
    quota: 1000,
    used: 400,
    remaining: 600,
    ...over,
  };
}

function plan(over: Partial<PlanBalance> = {}): PlanBalance {
  return {
    plan: 'minimax',
    plan_label: 'MiniMax Coding',
    source: 'minimax_coding_plan',
    status: 'ready',
    stale: false,
    message: '',
    fetched_at: '2026-09-15T11:00:00+08:00',
    windows: [win()],
    ...over,
  };
}

// -----------------------------------------------------------------------
// sortBalances：ready → partial → unavailable，同态稳定
// -----------------------------------------------------------------------
test('sortBalances orders ready/partial/unavailable and keeps input stable within a tier', () => {
  const a = plan({ plan: 'ark', plan_label: '火山方舟', status: 'unavailable' });
  const b = plan({ plan: 'minimax', plan_label: 'MiniMax Coding', status: 'ready' });
  const c = plan({ plan: 'cursor', plan_label: 'Cursor', status: 'partial' });
  const d = plan({ plan: 'claude', plan_label: 'Claude Pro', status: 'ready' });
  const out = sortBalances([a, b, c, d]);
  assert.deepEqual(
    out.map((p) => p.plan),
    ['minimax', 'claude', 'cursor', 'ark'],
  );
});

test('sortBalances does not mutate the input array', () => {
  const arr = [
    plan({ plan: 'a', status: 'unavailable' }),
    plan({ plan: 'b', status: 'ready' }),
  ];
  const snapshot = arr.map((p) => p.plan);
  sortBalances(arr);
  assert.deepEqual(arr.map((p) => p.plan), snapshot);
});

// -----------------------------------------------------------------------
// planTitle：卡片标题直接用供应商名
// -----------------------------------------------------------------------
test('planTitle prefers plan_label (vendor display name)', () => {
  assert.equal(planTitle(plan({ plan_label: '火山方舟', plan: 'ark' })), '火山方舟');
});

test('planTitle falls back to plan id when label missing/blank', () => {
  assert.equal(planTitle(plan({ plan: 'cursor', plan_label: '' })), 'cursor');
  assert.equal(planTitle(plan({ plan: 'cursor', plan_label: '   ' })), 'cursor');
});

// -----------------------------------------------------------------------
// selectWindow / hasWindowPct / otherWindows
// -----------------------------------------------------------------------
test('selectWindow returns the tab-selected window', () => {
  const p = plan({
    windows: [
      win({ window: 'five_hour' }),
      win({ window: 'weekly_limit', window_label: '周窗口' }),
    ],
  });
  assert.equal(selectWindow(p, 'weekly_limit')?.window, 'weekly_limit');
});

test('selectWindow falls back to first window when the tab is absent', () => {
  const p = plan({ windows: [win({ window: 'five_hour' })] });
  assert.equal(selectWindow(p, 'monthly')?.window, 'five_hour');
});

test('selectWindow returns null for a provider with no windows', () => {
  assert.equal(selectWindow(plan({ windows: [] }), 'five_hour'), null);
});

test('hasWindowPct is true only when both used and remaining are present', () => {
  assert.equal(hasWindowPct(win({ used_pct: 30, remaining_pct: 70 })), true);
  assert.equal(hasWindowPct(win({ used_pct: null, remaining_pct: 70 })), false);
  assert.equal(hasWindowPct(win({ used_pct: 30, remaining_pct: null })), false);
  assert.equal(hasWindowPct(null), false);
});

test('otherWindows excludes the main window only', () => {
  const p = plan({
    windows: [
      win({ window: 'five_hour' }),
      win({ window: 'weekly_limit' }),
      win({ window: 'monthly' }),
    ],
  });
  const main = selectWindow(p, 'five_hour');
  assert.deepEqual(
    otherWindows(p, main).map((w) => w.window),
    ['weekly_limit', 'monthly'],
  );
});

test('otherWindows is empty when main is null', () => {
  assert.deepEqual(otherWindows(plan({ windows: [] }), null), []);
});

// -----------------------------------------------------------------------
// 防双算护栏：展示层只透传 server 给的 remaining_pct，不自行 100-used
// -----------------------------------------------------------------------
test('view layer never recomputes remaining (anti double-count): keeps server values even if odd', () => {
  // 即使 server 给的 used/remaining 不是严格互补（理论上不会，但展示层不得纠偏）
  const odd = win({ used_pct: 40, remaining_pct: 55 });
  const p = plan({ windows: [odd] });
  const selected = selectWindow(p, 'five_hour');
  assert.ok(selected);
  assert.equal(selected!.used_pct, 40);
  assert.equal(selected!.remaining_pct, 55, '必须原样透传，禁止展示层重算');
});

// -----------------------------------------------------------------------
// 布局配置位
// -----------------------------------------------------------------------
test('resolveLayout defaults to separate (split cards per vendor)', () => {
  assert.equal(resolveLayout(undefined), 'separate');
  assert.equal(resolveLayout(null), 'separate');
  assert.equal(resolveLayout('bogus'), 'separate');
  assert.equal(DEFAULT_PLAN_BALANCE_LAYOUT, 'separate');
});

test('resolveLayout allows explicit unified opt-in', () => {
  assert.equal(resolveLayout('unified'), 'unified');
  assert.equal(resolveLayout('separate'), 'separate');
});

test('WINDOW_TABS exposes 5h/周/月 keys and the separate grid is a responsive grid', () => {
  assert.deepEqual(WINDOW_TABS.map((t) => t.key), ['five_hour', 'weekly_limit', 'monthly']);
  assert.match(SEPARATE_GRID_CLASS, /grid/);
  assert.match(SEPARATE_GRID_CLASS, /sm:grid-cols-2/);
  assert.match(SEPARATE_GRID_CLASS, /lg:grid-cols-2/);
});

// -----------------------------------------------------------------------
// 阈值分档：used_pct <75 normal / >=75 warn / >=90 critical（对齐安卓 gTierColor）
// 只用 sidecar 给的 used_pct 分档，不碰 remaining_pct（防双算）
// -----------------------------------------------------------------------
test('usageTier thresholds on used_pct: <75 normal, >=75 warn, >=90 critical, null unknown', () => {
  assert.equal(usageTier(0), 'normal');
  assert.equal(usageTier(74.9), 'normal');
  assert.equal(usageTier(75), 'warn');
  assert.equal(usageTier(89.9), 'warn');
  assert.equal(usageTier(90), 'critical');
  assert.equal(usageTier(100), 'critical');
  assert.equal(usageTier(null), 'unknown');
  assert.equal(usageTier(undefined), 'unknown');
  assert.equal(usageTier(Number.NaN), 'unknown');
});

// -----------------------------------------------------------------------
// 双语义：5h=限流(429, 紫)；周/月=预算(402, 琥珀/红)；两种红不得共用
// -----------------------------------------------------------------------
test('windowSemantic maps five_hour to rate and weekly/monthly to budget', () => {
  assert.equal(windowSemantic(win({ window: 'five_hour' })), 'rate');
  assert.equal(windowSemantic(win({ window: 'weekly_limit' })), 'budget');
  assert.equal(windowSemantic(win({ window: 'monthly' })), 'budget');
});

test('windowTone: budget windows use blue/amber/red with 预算 text tags', () => {
  const normal = windowTone(win({ window: 'monthly', used_pct: 50 }));
  assert.equal(normal.barClass, 'bg-accent');
  assert.equal(normal.tag, null);

  const warn = windowTone(win({ window: 'weekly_limit', used_pct: 80 }));
  assert.equal(warn.barClass, 'bg-warning');
  assert.equal(warn.tag, '预算偏紧');
  assert.ok(warn.tagClass?.includes('text-warning'));

  const critical = windowTone(win({ window: 'monthly', used_pct: 95 }));
  assert.equal(critical.barClass, 'bg-danger');
  assert.equal(critical.tag, '预算临界');
  assert.ok(critical.tagClass?.includes('text-danger'));
});

test('windowTone: rate window uses violet (never danger red) at high usage with 限流 tag', () => {
  const warn = windowTone(win({ window: 'five_hour', used_pct: 80 }));
  assert.equal(warn.barClass, 'bg-violet-500');
  assert.equal(warn.tag, '限流偏紧');
  assert.ok(warn.tagClass?.includes('violet'));

  const critical = windowTone(win({ window: 'five_hour', used_pct: 99 }));
  assert.equal(critical.barClass, 'bg-violet-500');
  assert.equal(critical.tag, '限流临界');
  // 关键不变量：限流语义绝不能用预算的红
  assert.ok(!critical.barClass.includes('danger'));
  assert.ok(!critical.tagClass?.includes('danger'));

  const normal = windowTone(win({ window: 'five_hour', used_pct: 10 }));
  assert.equal(normal.barClass, 'bg-accent');
  assert.equal(normal.tag, null);
});

test('windowTone: missing used_pct renders neutral grey with no tag', () => {
  const t = windowTone(win({ window: 'five_hour', used_pct: null }));
  assert.equal(t.tier, 'unknown');
  assert.equal(t.barClass, 'bg-default-300');
  assert.equal(t.tag, null);
});

test('STATUS_LABEL provides a non-color text channel for all three states', () => {
  assert.deepEqual(Object.keys(STATUS_LABEL).sort(), ['partial', 'ready', 'unavailable']);
  for (const label of Object.values(STATUS_LABEL)) {
  assert.ok(label.length > 0);
  }
});

// -----------------------------------------------------------------------
// stale 卡内指示相对时间文案（formatUpdatedAgo，可注入 now）
// -----------------------------------------------------------------------
test('formatUpdatedAgo renders relative Chinese labels', () => {
  const now = new Date('2026-09-15T12:00:00+08:00').getTime();
  assert.equal(formatUpdatedAgo(null, now), null);
  assert.equal(formatUpdatedAgo(new Date(now - 5_000), now), '刚刚');
  assert.equal(formatUpdatedAgo(new Date(now - 3 * 60_000), now), '3 分钟前');
  assert.equal(formatUpdatedAgo(new Date(now - 2 * 3_600_000), now), '2 小时前');
  assert.equal(formatUpdatedAgo(new Date(now - 3 * 86_400_000), now), '3 天前');
  // 时钟回拨等异常情况不输出负数
  assert.equal(formatUpdatedAgo(new Date(now + 60_000), now), '刚刚');
});
