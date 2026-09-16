// SPDX-License-Identifier: MIT
// shared/pet-quota-bubble.ts — 桌面宠物「套餐余量」气泡的零框架纯逻辑核心层
//
// 军规（exec.md §7/§10）：不 import React/Electron/DOM/date-fns；凡涉当前时刻
// 一律由调用方注入 nowMs（epoch ms），使「最紧张额度 / 下一个重置点」等边沿
// 可端到端单测。组件只做 I/O（window.tud 拉取、事件订阅）与渲染编排。
import type {
  ArkRateLimitWindow,
  ArkSubscriptionSnapshot,
  ArkTokenPack,
} from './ark-subscription.js';

/** 气泡内 limits 的固定展示顺序（与 ArkSubscriptionCard 一致）。 */
export const PET_QUOTA_WINDOW_ORDER: ReadonlyArray<ArkRateLimitWindow['id']> = [
  'five-hour',
  'weekly',
  'monthly',
];

export interface PetQuotaBubbleModel {
  planLabel: string | null;
  /** 按 five-hour → weekly → monthly 排序、去重后的窗口（至多 3 条）。 */
  limits: ArkRateLimitWindow[];
  /** remaining/total 比例最低的 Token 额度池；无可用池子时为 null。 */
  tightestPack: ArkTokenPack | null;
  /** 最近一个尚未到来的重置时刻（epoch 秒）；全部已过期/未知时为 null。 */
  nextResetSec: number | null;
}

/**
 * 排序并去重速率窗口：重复 id 保留先出现者，未知 id 丢弃，至多 3 条。
 * 不修改入参数组。
 */
export function orderArkRateLimits(
  limits: readonly ArkRateLimitWindow[],
): ArkRateLimitWindow[] {
  const seen = new Set<ArkRateLimitWindow['id']>();
  const out: ArkRateLimitWindow[] = [];
  for (const id of PET_QUOTA_WINDOW_ORDER) {
    const win = limits.find((candidate) => candidate.id === id && !seen.has(id));
    if (win) {
      seen.add(id);
      out.push(win);
    }
  }
  return out;
}

/**
 * 选出剩余比例（remaining/total）最低、即最紧张的 Token 额度池：
 * - total 非有限正数的池子跳过；
 * - remaining 允许为负（过期降档），比例最低自然胜出；
 * - 比例相同保留先出现者（Array.prototype.find 语义）。
 */
export function selectTightestTokenPack(
  packs: readonly ArkTokenPack[],
): ArkTokenPack | null {
  let tightest: ArkTokenPack | null = null;
  let tightestRatio = Number.POSITIVE_INFINITY;
  for (const pack of packs) {
    if (!Number.isFinite(pack.total) || pack.total <= 0) continue;
    const ratio = pack.remaining / pack.total;
    if (ratio < tightestRatio) {
      tightestRatio = ratio;
      tightest = pack;
    }
  }
  return tightest;
}

/**
 * 选出最近一个严格晚于 nowMs 的重置时刻（epoch 秒）。
 * 全部为 null / 非有限 / 已过期时返回 null。nowMs 由调用方注入。
 */
export function selectNextResetSec(
  limits: readonly ArkRateLimitWindow[],
  nowMs: number,
): number | null {
  let next: number | null = null;
  for (const win of limits) {
    const sec = win.resetsAt;
    if (sec === null || !Number.isFinite(sec)) continue;
    if (sec * 1000 <= nowMs) continue;
    if (next === null || sec < next) next = sec;
  }
  return next;
}

/** 百分比展示：非有限值归 0，结果夹到 0..100，四舍五入到整数百分比。 */
export function formatQuotaPercent(usedPercent: number): string {
  if (!Number.isFinite(usedPercent)) return '0%';
  const clamped = Math.max(0, Math.min(100, usedPercent));
  return `${Math.round(clamped)}%`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * epoch 秒 → 「MM-dd HH:mm 重置」（渲染进程本地时区）。
 * null / 非有限 / 非正时间戳返回 null；本函数不读系统时钟，只做纯格式化。
 */
export function formatQuotaResetLabel(resetsAtSec: number | null): string | null {
  if (resetsAtSec === null || !Number.isFinite(resetsAtSec) || resetsAtSec <= 0) {
    return null;
  }
  const date = new Date(resetsAtSec * 1000);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
    + `${pad2(date.getHours())}:${pad2(date.getMinutes())} 重置`;
}

/**
 * 把 Ark 快照收敛成气泡视图模型（单一无状态入口）：
 * limits 与 tokenPacks 皆空（未配置 / 鉴权失败 / 自定义 provider 等）→ null，
 * 组件据此完全不渲染、不占位。nowMs 由调用方注入，默认 Date.now()。
 */
export function buildPetQuotaBubbleModel(
  snapshot: ArkSubscriptionSnapshot,
  nowMs: number = Date.now(),
): PetQuotaBubbleModel | null {
  if (snapshot.limits.length === 0 && snapshot.tokenPacks.length === 0) {
    return null;
  }
  const limits = orderArkRateLimits(snapshot.limits);
  return {
    planLabel: snapshot.planLabel,
    limits,
    tightestPack: selectTightestTokenPack(snapshot.tokenPacks),
    nextResetSec: selectNextResetSec(limits, nowMs),
  };
}

export type PetQuotaBubbleMode = 'off' | 'periodic' | 'persistent';

export interface MergedPetBubbleInput {
  /** 额度气泡 pref 模式。 */
  mode: PetQuotaBubbleMode;
  /** periodic 模式当前是否处于 10s 展开窗口。 */
  periodicOpen: boolean;
  /** off 模式：点击 sprite 手动展开的「今日」气泡开关。 */
  tooltipOpen: boolean;
  /** persistent/periodic：点击 sprite 收起/展开上区「今日」（额度区不受影响）。 */
  todayCollapsed: boolean;
  /** Ark 快照存在任一 limits/tokenPacks（额度区是否有内容）。 */
  quotaReady: boolean;
  /** sync 庆祝反馈是否正在展示（最高优先级临时覆盖）。 */
  syncActive: boolean;
}

export interface MergedPetBubbleState {
  /** 气泡容器是否渲染。 */
  bubbleVisible: boolean;
  showSync: boolean;
  /** 上区「今日」是否渲染。 */
  showToday: boolean;
  /** 下区「套餐余量」是否渲染。 */
  showQuota: boolean;
  /**
   * 今日统计是否应保持拉取/轮询：persistent 常驻拉取；periodic 即使在
   * 两次展开窗口之间也保持预取，弹出即有数据；off 仅手动展开时拉取。
   */
  summaryPollActive: boolean;
}

/**
 * 合并气泡显隐的单一无状态决策点（DesktopPetView 只做事件转发与渲染）：
 * - sync 反馈最高优先级，展示期间覆盖两个分区；
 * - persistent：气泡常驻，额度区按 quotaReady 有无独立存亡（无数据时
 * * 只显示今日），点击 sprite 仅切换今日区收起；
 * - periodic：仅 10s 窗口内显示合并内容；
 * - off：点击 sprite 才显示、且只有今日区。
 */
export function resolveMergedPetBubble(input: MergedPetBubbleInput): MergedPetBubbleState {
  const { mode, periodicOpen, tooltipOpen, todayCollapsed, quotaReady, syncActive } = input;
  const mergedActive = mode === 'persistent' || (mode === 'periodic' && periodicOpen);
  const showQuota = mergedActive && quotaReady;
  const showToday = mode === 'off'
    ? tooltipOpen
    : mergedActive && !todayCollapsed;
  return {
    bubbleVisible: syncActive || showQuota || showToday,
    showSync: syncActive,
    showToday: syncActive ? false : showToday,
    showQuota: syncActive ? false : showQuota,
    summaryPollActive: tooltipOpen || mode === 'persistent' || mode === 'periodic',
  };
}
