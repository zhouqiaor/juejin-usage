// SPDX-License-Identifier: MIT
// shared/pet-mood.ts — 套餐余量 → 桌宠情绪状态（M0 纯逻辑核心层）
//
// 军规（exec.md §7/§10）：零框架/零设备依赖——不 import React/Electron/DOM，
// 时间一律由调用方注入 nowSec，本文件不持有任何状态（reset 去重靠调用方回传
// lastResetFireKey 表达），使分层边界、多 provider 聚合、reset 边沿、unknown
// 与 exhausted 的区分都能在 node:test 下端到端验证。
//
// 设计依据：docs/2026-09-16-pet-quota-visualization-research.md §3.1（四层状态映射）。

/** 七态：五档用量情绪 + reset 边沿演出 + 无数据（unknown 必须区别于 exhausted）。 */
export type PetMood =
  | 'healthy'
  | 'loaded'
  | 'tense'
  | 'alerting'
  | 'exhausted'
  | 'resetting'
  | 'unknown';

export type MoodWindowId = 'five-hour' | 'weekly' | 'monthly';

/** 一个 provider 的一条归一化用量窗口；resetsAt 为 epoch 秒（null = 重置点未知）。 */
export interface MoodInputWindow {
  provider: string;
  id: MoodWindowId;
  usedPercent: number;
  resetsAt: number | null;
}

export interface PetMoodInput {
  windows: MoodInputWindow[];
  /** 归一化层给的快照状态；只有严格等于 'ready' 才有资格演情绪。 */
  status: string;
  /** 快照陈旧（拉取失败后沿用旧值等）：没数据不能演成耗尽。 */
  stale: boolean;
  /** 注入时钟，epoch 秒。 */
  nowSec: number;
  /** 上次已演出过的 reset 边沿 key（由调用方持久并回传）。 */
  lastResetFireKey?: string | null;
  /**
   * 告警阈值，接 desktop-pref 的 quotaAlertThreshold（默认 90）。
   * 非法值（非有限数 / 不在 (0,100]）静默回退默认值——pref 数据损坏不应炸渲染层。
   */
  quotaAlertThreshold?: number | null;
}

export interface PetMoodResult {
  mood: PetMood;
  /** 驱动当前情绪（最紧急）的 provider；unknown 时为 null。 */
  activeProvider: string | null;
  /** 驱动当前情绪的窗口 id；unknown 时为 null。 */
  activeWindow: MoodWindowId | null;
  /** 本次评估新跨过的 reset 边沿 key（仅边沿那一帧非 null）。 */
  resetFiredKey: string | null;
}

export const DEFAULT_PET_MOOD_ALERT_THRESHOLD = 90;
export const PET_MOOD_EXHAUSTED_PERCENT = 98;
export const PET_MOOD_TENSE_FLOOR_PERCENT = 80;
export const PET_MOOD_LOADED_FLOOR_PERCENT = 60;
/** resetting 闪光时长（毫秒）——纯函数只给常量，1.2s 计时是渲染层职责。 */
export const PET_MOOD_RESET_FLASH_MS = 1200;

const WINDOW_IDS: readonly MoodWindowId[] = ['five-hour', 'weekly', 'monthly'];

/**
 * 短窗口权重更高：同百分比下 5h 剩余绝对额度更少、先耗尽，故并列时 5h 更紧。
 * 排序只用作并列裁决，百分比差距始终优先（95% 的月窗口比 60% 的 5h 更紧急）。
 */
const WINDOW_RANK: Record<MoodWindowId, number> = {
  'five-hour': 0,
  weekly: 1,
  monthly: 2,
};

interface ValidWindow {
  provider: string;
  id: MoodWindowId;
  percent: number;
  resetsAt: number | null;
  /** 原始入参下标，保证并列时稳定排序。 */
  index: number;
}

/**
 * 非法输入确定规则（与 pet-quota-alert.normalizePercent 同一口径）：
 * - usedPercent 非有限值（NaN/Infinity）→ 整条窗口丢弃，不猜测；
 * - usedPercent 有限但越界（<0 / >100，上游常见脏数据）→ clamp 进 [0,100]；
 * - provider 非字符串/空串、id 不在三窗口枚举 → 丢弃；
 * - resetsAt 非有限值 → 按 null（重置点未知）处理，窗口本身保留。
 */
function validateWindow(raw: MoodInputWindow, index: number): ValidWindow | null {
  if (typeof raw.provider !== 'string' || raw.provider.length === 0) return null;
  if (typeof raw.id !== 'string' || !WINDOW_IDS.includes(raw.id as MoodWindowId)) {
    return null;
  }
  if (typeof raw.usedPercent !== 'number' || !Number.isFinite(raw.usedPercent)) {
    return null;
  }
  const percent = Math.min(100, Math.max(0, raw.usedPercent));
  let resetsAt: number | null = null;
  if (raw.resetsAt === null) {
    resetsAt = null;
  } else if (typeof raw.resetsAt === 'number' && Number.isFinite(raw.resetsAt)) {
    resetsAt = raw.resetsAt;
  }
  return { provider: raw.provider, id: raw.id, percent, resetsAt, index };
}

/** 紧急度比较：百分比降序；并列时短窗口优先；再并列保持输入顺序。返回更紧者。 */
function tighterOf(a: ValidWindow, b: ValidWindow): ValidWindow {
  if (a.percent !== b.percent) return a.percent > b.percent ? a : b;
  const rankDiff = WINDOW_RANK[a.id] - WINDOW_RANK[b.id];
  if (rankDiff !== 0) return rankDiff < 0 ? a : b;
  return a.index <= b.index ? a : b;
}

/** reset 去重 key：同一 provider+窗口+同一重置点只触发一次。 */
function resetKey(w: ValidWindow): string {
  return `${w.provider}:${w.id}:${w.resetsAt}`;
}

function resolveThreshold(input: PetMoodInput): number {
  const t = input.quotaAlertThreshold;
  if (typeof t === 'number' && Number.isFinite(t) && t > 0 && t <= 100) return t;
  return DEFAULT_PET_MOOD_ALERT_THRESHOLD;
}

/**
 * 无状态情绪解析。优先级（短路顺序即决策）：
 *
 * 1. unknown：status !== 'ready' / stale / 没有任何合法窗口。
 *    unknown 下即使存在已跨过的 reset 也不触发（resetFiredKey 给 null，不消费
 *    边沿——等数据恢复 fresh 后同一重置点仍可演出），更不能把「没数据」演成耗尽。
 * 2. resetting：仅看**全局最紧窗口**（驱动当前情绪的那条）。它的 resetsAt 被
 *    nowSec 跨过、且 key 与调用方回传的 lastResetFireKey 不同 → 边沿触发一次。
 *    不扫描非最紧窗口：输入只有单个 key 位（不是每窗口 Map），背景窗口重置是
 *    噪声（5h 99% 时月窗口重置不该庆祝）；最紧窗口的重置正是用户关心的「松一口气」
 *    时刻，错过即无（它跨过之后百分比回落，自然不再最紧）。
 * 3. reset 边沿优先于 exhausted/alerting：边沿是「周期已切换」的事实，stale 快照
 *    可能仍报高百分比；闪光只演 1.2s（渲染层计时），下一帧评估即回到按百分比的
 *    mood，高百分比照样回到 exhausted/alerting，不会被吞掉。
 * 4. 按最紧窗口百分比分层：<60 healthy；<80 loaded；<阈值 tense；<98 alerting；
 *    ≥98 exhausted（exhausted 优先于阈值档）。
 */
export function resolvePetMood(input: PetMoodInput): PetMoodResult {
  if (typeof input?.nowSec !== 'number' || !Number.isFinite(input.nowSec)) {
    throw new RangeError('nowSec must be a finite number');
  }
  if (!Array.isArray(input.windows)) {
    throw new TypeError('windows must be an array');
  }

  const unknown: PetMoodResult = {
    mood: 'unknown',
    activeProvider: null,
    activeWindow: null,
    resetFiredKey: null,
  };

  if (input.status !== 'ready' || input.stale === true) return unknown;

  const valid = input.windows.flatMap((w, i) => {
    const v = validateWindow(w, i);
    return v ? [v] : [];
  });
  if (valid.length === 0) return unknown;

  // 每 provider 取最紧窗口，再全局取最紧（两步同一比较器，flat 后直接归并即可，
  // 跨 provider 与 provider 内规则一致）。
  const tightest = valid.reduce((acc, w) => tighterOf(acc, w));

  // reset 边沿：只认最紧窗口，只认新 key（同一 resetsAt 连续轮询不重复）。
  if (
    tightest.resetsAt !== null
    && input.nowSec >= tightest.resetsAt
    && resetKey(tightest) !== (input.lastResetFireKey ?? null)
  ) {
    return {
      mood: 'resetting',
      activeProvider: tightest.provider,
      activeWindow: tightest.id,
      resetFiredKey: resetKey(tightest),
    };
  }

  const threshold = resolveThreshold(input);
  let mood: PetMood;
  if (tightest.percent >= PET_MOOD_EXHAUSTED_PERCENT) {
    mood = 'exhausted';
  } else if (tightest.percent >= threshold) {
    mood = 'alerting';
  } else if (tightest.percent >= PET_MOOD_TENSE_FLOOR_PERCENT) {
    mood = 'tense';
  } else if (tightest.percent >= PET_MOOD_LOADED_FLOOR_PERCENT) {
    mood = 'loaded';
  } else {
    mood = 'healthy';
  }

  return {
    mood,
    activeProvider: tightest.provider,
    activeWindow: tightest.id,
    resetFiredKey: null,
  };
}
