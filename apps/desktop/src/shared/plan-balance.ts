// SPDX-License-Identifier: MIT
// shared/plan-balance.ts — Coding Plan 余量数据模型（preload + main + renderer 共享）
//
// 用途：与 prototype/plan_balance.py 归一层的 PlanBalance 字段一一对应，
//      不引入、不删除，便于将来 backend 切换（HTTP / FFI / 直连）。
//
// 范围：types-only（无运行时代码），所有引方都 import 此文件。
//
// 位置约定：apps/desktop/src/shared/ 与 auto-update.ts / dashboard-range.ts /
//          theme.ts / codex-subscription.ts 等并列，符合 vendor 既有架构。
//
// 上游契约：docs/QUOTA-UI-SPEC-2026-09-15.md §5
// 三态对齐：prototype/plan_balance.py:53-55 (READY/PARTIAL/UNAVAILABLE)

/** Coding Plan 余量三态（与 plan_balance.py 字面一致） */
export type PlanStatus = "ready" | "partial" | "unavailable";

/** 单个余量窗口（5h / 周 / 月 / 自定义如 sevenDay） */
export interface PlanWindow {
  /** 窗口 id（与 plan_balance.py 的 FIVE_HOUR / WEEKLY / MONTHLY 常量对齐） */
  window: "five_hour" | "weekly_limit" | "monthly" | "sevenDay" | string;
  /** 人类可读标签（"5 小时窗口"） */
  window_label: string;
  /** 已用百分比 0..100；null 表示数据缺失（部分场景如 partial 状态） */
  used_pct: number | null;
  /** 剩余百分比 0..100；null 同上。renderer 永远不重算，仅显示 server 给的 */
  remaining_pct: number | null;
  /** ISO 时间（+08:00），如 "2026-09-15 17:00:00" */
  resets_at: string | null;
  /** 总额度（绝对值，仅透传展示） */
  quota: number | null;
  /** 已用（绝对值，仅透传展示） */
  used: number | null;
  /** 剩余（绝对值，仅透传展示） */
  remaining: number | null;
  /** 多模型时标注（MiniMax 每模型一窗口） */
  model?: string;
  /** 套餐类型（方舟 PlanType，如 "pro"） */
  plan_type?: string;
}

/** 单 provider 的余量聚合 */
export interface PlanBalance {
  /** provider id（minimax / ark / claude_pro / cursor） */
  plan: string;
  /** 显示源（"MiniMax Coding"），UI 渲染时优先用 plan_label */
  plan_label: string;
  /** 数据源（minimax_coding_plan / volcengine_ark / juejin_desktop_subscription） */
  source: string;
  /** 三态（ready / partial / unavailable） */
  status: PlanStatus;
  /** 数据是否陈旧（熔断 / 限流 / 超时降级） */
  stale: boolean;
  /** 错误 / 降级提示（**不含 Key 任何字段**，已脱敏） */
  message: string;
  /** 抓取时间 ISO +08:00 */
  fetched_at: string;
  /** 多窗口数组（5h / 周 / 月） */
  windows: PlanWindow[];
}

/** 整个 8462/plan_balance 端点返回的 snapshot */
export interface PlanBalanceSnapshot {
  /** 整个 snapshot 生成时间（由 quota-hub 后端加） */
  generated_at: string;
  /** true = 离线示例（无 Key 或 CI 演示）；false = 真实拉取 */
  snapshot: boolean;
  /** 多 provider 数组 */
  balances: PlanBalance[];
}

/** IPC 信封（与现有 tud:api-request 信封一致） */
export interface PlanBalanceEnvelope<T = PlanBalanceSnapshot> {
  success: boolean;
  message?: string;
  data?: T;
}

/** IPC channel 名（与 preload 暴露一致） */
export const PLAN_BALANCE_IPC = {
  /** 拉取余量 */
  PULL: "tud:plan-balance",
  /** 强制刷新（清 5s 缓存） */
  REFRESH: "tud:plan-balance-refresh",
  /** 查各 provider 凭证是否配置 */
  KEY_STATUS: "tud:plan-balance-key-status",
} as const;

/** 单 provider 凭证状态（cc-switch `credentialStatus` 对齐） */
export type PlanBalanceKeyStatus = {
  plan: string;
  configured: boolean;
  source: "minimax_coding_plan" | "volcengine_ark" | "juejin_desktop_subscription" | string;
};
