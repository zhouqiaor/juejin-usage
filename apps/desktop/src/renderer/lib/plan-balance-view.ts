// SPDX-License-Identifier: MIT
// renderer/lib/plan-balance-view.ts — Coding Plan 余量「纯展示逻辑」
//
// 为什么单独抽出来：
//   - 排序 / 当前窗口选择 / 布局模式都是与 React 无关的纯函数，便于分层单测
//   - 架构预留：多 provider 支持「分卡 separate / 合一 unified」两种布局，
//     默认 separate（2026-09-15 用户拍板），后续可做用户偏好开关，组件层零改动
//
// 安全：本文件不做任何 remaining_pct 重算（HANDOVER §0 铁律 #1 防双算），只挑选/排序。

import type { PlanBalance, PlanStatus, PlanWindow } from './plan-balance-types';

/** 多 provider 布局：separate=每个供应商独立卡片；unified=合并到一张大卡 */
export type PlanBalanceLayout = 'separate' | 'unified';

/** 默认布局：分卡（每张卡标题=供应商名） */
export const DEFAULT_PLAN_BALANCE_LAYOUT: PlanBalanceLayout = 'separate';

export type WindowKey = 'five_hour' | 'weekly_limit' | 'monthly';

export const WINDOW_TABS: Array<{ key: WindowKey; label: string }> = [
  { key: 'five_hour', label: '5h' },
  { key: 'weekly_limit', label: '周' },
  { key: 'monthly', label: '月' },
];

/** 三态展示优先级：ready 在左、unavailable 在右（同态内保持后端原序） */
const STATUS_ORDER: Record<PlanStatus, number> = {
  ready: 0,
  partial: 1,
  unavailable: 2,
};

/** 不 mutate 原数组的稳定排序（同状态保持原序 → 后端 minimax→ark 顺序稳定） */
export function sortBalances(arr: readonly PlanBalance[]): PlanBalance[] {
  return [...arr].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
  );
}

/** 卡片标题：直接用供应商名称（plan_label 已由后端给中文友好名，如「MiniMax Coding」「火山方舟」） */
export function planTitle(plan: PlanBalance): string {
  return plan.plan_label?.trim() || plan.plan;
}

/**
 * 选中某 tab 对应的窗口；该 provider 没有此窗口时回退到第一个窗口。
 * 返回 null 表示无任何窗口（unavailable / 未配置）。
 */
export function selectWindow(
  plan: PlanBalance,
  key: WindowKey,
): PlanWindow | null {
  if (!plan.windows || plan.windows.length === 0) return null;
  return plan.windows.find((w) => w.window === key) ?? plan.windows[0];
}

/** 主窗口是否有可渲染的百分比（used/remaining 都在才算数，避免半截 UI） */
export function hasWindowPct(w: PlanWindow | null): w is PlanWindow {
  return !!w && w.used_pct != null && w.remaining_pct != null;
}

/** 除主窗口外的其余窗口（紧凑行）。
 *  复合键 (window + model)：MiniMax 等多模型同 tier 时按 model 区分显示，
 *  不再用 `w.window !== main.window` 单字段过滤（会把同类型不同模型的全部隐藏）。
 */
export function otherWindows(
  plan: PlanBalance,
  main: PlanWindow | null,
): PlanWindow[] {
  if (!main) return [];
  return plan.windows.filter(
    (w) => !(w.window === main.window && (w.model ?? '') === (main.model ?? '')),
  );
}

/** 分卡网格的响应式列class：与 DashboardPage 用量图表 section 对齐（1 列/2 列），不强制 3 列占满宽度 */
export const SEPARATE_GRID_CLASS =
  'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2';

/** 解析布局（非法值回退默认），给将来用户偏好开关留口 */
export function resolveLayout(value: unknown): PlanBalanceLayout {
  return value === 'unified' ? 'unified' : DEFAULT_PLAN_BALANCE_LAYOUT;
}
