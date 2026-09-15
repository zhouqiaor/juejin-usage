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
  WINDOW_TABS,
  hasWindowPct,
  otherWindows,
  planTitle,
  resolveLayout,
  selectWindow,
  sortBalances,
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
