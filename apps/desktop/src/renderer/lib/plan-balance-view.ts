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

// ---------------------------------------------------------------------------
// 双语义窗口色调 + 阈值进度条（2026-09-15 UX polish）
//
// 两套语义不可共用一种红（docs UX 决议）：
//   - five_hour 是速率限制语义（HTTP 429）：紧张用紫色系 + 「限流」文字标签
//   - weekly_limit / monthly 是预算语义（HTTP 402）：紧张用琥珀/红 + 「预算」文字标签
// 阈值对齐安卓 QuotaWidget.kt gTierColor（以 used_pct 判定，不用 remaining_pct）：
//   <75 正常（accent 蓝） · >=75 预警 · >=90 临界
// 颜色永远伴随文字标签（无障碍：不能仅靠颜色）。
// 注意：这里只读 sidecar 给的 used_pct，绝不重算 remaining_pct（防双算铁律）。
// ---------------------------------------------------------------------------

export type UsageTier = 'normal' | 'warn' | 'critical' | 'unknown';

/** five_hour=限流（429 语义）；周/月=预算（402 语义） */
export type WindowSemantic = 'rate' | 'budget';

export const USAGE_WARN_GE = 75;
export const USAGE_CRITICAL_GE = 90;

/** 已用率分档（null/NaN → unknown，进度条走中性灰，不臆造颜色） */
export function usageTier(usedPct: number | null | undefined): UsageTier {
  if (usedPct == null || Number.isNaN(usedPct)) return 'unknown';
  if (usedPct >= USAGE_CRITICAL_GE) return 'critical';
  if (usedPct >= USAGE_WARN_GE) return 'warn';
  return 'normal';
}

/** 窗口语义：5h 速率窗口 vs 周/月预算窗口 */
export function windowSemantic(w: Pick<PlanWindow, 'window'>): WindowSemantic {
  return w.window === 'five_hour' ? 'rate' : 'budget';
}

export interface WindowTone {
  tier: UsageTier;
  semantic: WindowSemantic;
  /** 进度条填充 class */
  barClass: string;
  /** 紧张时的文字标签（始终非空 iff 非 unknown 的 warn/critical），null=不显示 */
  tag: string | null;
  /** 标签 chip class（配色与文字标签成对出现） */
  tagClass: string | null;
}

const RATE_TAG_CLASS = 'bg-violet-500/10 text-violet-600 dark:text-violet-400';
const BUDGET_WARN_TAG_CLASS = 'bg-warning/15 text-warning';
const BUDGET_CRITICAL_TAG_CLASS = 'bg-danger/15 text-danger';

/**
 * 计算单个窗口的进度条色调与文字标签。
 * 纯函数，组件层禁止自行用 used_pct 拼 class（统一从此处取，保证两种布局口径一致）。
 */
export function windowTone(w: PlanWindow): WindowTone {
  const tier = usageTier(w.used_pct);
  const semantic = windowSemantic(w);

  if (tier === 'unknown') {
    return { tier, semantic, barClass: 'bg-default-300', tag: null, tagClass: null };
  }
  if (semantic === 'rate') {
    // 429 速率语义：与预算的红拉开色相，统一紫；临界只改文案不改色（紫本身已表义）
    if (tier === 'normal') {
      return { tier, semantic, barClass: 'bg-accent', tag: null, tagClass: null };
    }
    return {
      tier,
      semantic,
      barClass: 'bg-violet-500',
      tag: tier === 'critical' ? '限流临界' : '限流偏紧',
      tagClass: RATE_TAG_CLASS,
    };
  }
  // 402 预算语义
  if (tier === 'normal') {
    return { tier, semantic, barClass: 'bg-accent', tag: null, tagClass: null };
  }
  if (tier === 'critical') {
    return {
      tier,
      semantic,
      barClass: 'bg-danger',
      tag: '预算临界',
      tagClass: BUDGET_CRITICAL_TAG_CLASS,
    };
  }
  return {
    tier,
    semantic,
    barClass: 'bg-warning',
    tag: '预算偏紧',
    tagClass: BUDGET_WARN_TAG_CLASS,
  };
}

/** 三态中文标签（状态不能只靠颜色：徽章同时给文字） */
export const STATUS_LABEL: Record<PlanStatus, string> = {
  ready: '就绪',
  partial: '部分可用',
  unavailable: '不可用',
};

/** 三态徽章底色（数据完整度语义，与窗口阈值色是两回事） */
export const STATUS_BADGE_CLASS: Record<PlanStatus, string> = {
  ready: 'bg-success',
  partial: 'bg-warning',
  unavailable: 'bg-danger',
};

/** 相对时间文案：刚刚 / x 分钟前 / x 小时前 / x 天前（stale 卡内指示用，可注入 now 便于测试） */
export function formatUpdatedAgo(
  date: Date | null,
  nowMs: number = Date.now(),
): string | null {
  if (!date) return null;
  const ms = nowMs - date.getTime();
  if (!Number.isFinite(ms) || ms < 0) return '刚刚';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
