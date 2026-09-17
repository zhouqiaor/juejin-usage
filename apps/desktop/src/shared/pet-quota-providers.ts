// SPDX-License-Identifier: MIT
// shared/pet-quota-providers.ts — 桌面宠物气泡多 provider 套餐余量归一化核心层
//
// 军规（exec.md §7）：所有 provider 快照 → 统一气泡模型的映射都在这里，
// 零 React/Electron/DOM 依赖，可在 node:test 下独立验证。
// renderer 只负责并发拉取（Promise.allSettled）与渲染。
import type { AntigravitySubscriptionSnapshot } from './antigravity-subscription.js';
import type { ArkSubscriptionSnapshot, ArkTokenPack } from './ark-subscription.js';
import { arkPlanTitle } from './ark-subscription.js';
import type { ClaudeSubscriptionSnapshot } from './claude-subscription.js';
import type { CodexSubscriptionSnapshot } from './codex-subscription.js';
import type { CursorSubscriptionSnapshot } from './cursor-subscription.js';
import type { DeepSeekSubscriptionSnapshot } from './deepseek-subscription.js';
import type { GrokSubscriptionSnapshot } from './grok-subscription.js';
import type { KimiSubscriptionSnapshot } from './kimi-subscription.js';
import type { MiniMaxSubscriptionSnapshot } from './minimax-subscription.js';
import type { OpenCodeSubscriptionSnapshot } from './opencode-subscription.js';
import {
  orderArkRateLimits,
  selectTightestTokenPack,
} from './pet-quota-bubble.js';
import type { QoderSubscriptionSnapshot } from './qoder-subscription.js';
import {
  formatResetCountdownShort,
  formatResetCountdownZh,
} from './subscription-reset.js';
import type { TraeSubscriptionSnapshot } from './trae-subscription.js';
import type { WorkBuddySubscriptionSnapshot } from './workbuddy-subscription.js';
import type { ZcodeSubscriptionSnapshot } from './zcode-subscription.js';

/** 气泡内一个归一化速率窗口。resetsAtSec 为 epoch 秒（null = 未知）。 */
export interface PetQuotaWindow {
  id: string;
  label: string;
  kind: PetQuotaWindowKind;
  usedPercent: number;
  resetsAtSec: number | null;
  /** 窗口行右侧可选的字面量补充（如 DeepSeek「¥x / ¥y」），无则 null。 */
  detail: string | null;
}

export type PetQuotaWindowKind = 'five-hour' | 'weekly' | 'monthly' | 'other';

/** Ark tokenPacks 折叠摘要（只保留最紧张一池，不逐模型展开）。 */
export interface PetQuotaTightestPack {
  displayName: string;
  label: ArkTokenPack['label'];
  remaining: number;
  total: number;
}

export interface PetQuotaProviderSection {
  /** 全局唯一 provider key（trae/workbuddy 按区、minimax 按 region 区分）。 */
  provider: PetProviderKey;
  /** 区块标题，取自各 *SubscriptionCard 既有命名，不发明新名。 */
  title: string;
  /** 套餐档位（Pro / Team 等），标题右侧弱化展示；无则 null。 */
  planLabel: string | null;
  /** 快照是否 stale：保留在模型里供 mood/告警逻辑使用；气泡不渲染可见标记。 */
  stale: boolean;
  /** 已按 five-hour → weekly → monthly → other 排序、至多 3 个窗口。 */
  windows: PetQuotaWindow[];
  /** 重点窗口：有 5h 取 5h，否则取最紧张（已用最高）窗口，恒为 windows[0]。 */
  primary: PetQuotaWindow;
  /** 仅 Ark：免费额度/资源包最紧张一池摘要。 */
  tightestPack: PetQuotaTightestPack | null;
}

export interface PetQuotaAggregate {
  /** 主窗口已用百分比降序（最紧张在前），同值保持拉取顺序。 */
  sections: PetQuotaProviderSection[];
  /** 全部窗口中最近一个未来重置点（epoch 秒）；无则 null。 */
  nextResetSec: number | null;
}

export type PetProviderKey =
  | 'codex'
  | 'claude'
  | 'cursor'
  | 'grok'
  | 'kimi'
  | 'zcode'
  | 'antigravity'
  | 'qoder'
  | 'minimax'
  | 'ark'
  | 'deepseek'
  | 'opencode'
  | 'trae-global'
  | 'trae-cn'
  | 'workbuddy-global'
  | 'workbuddy-mainland';

/** renderer 聚合拉取的一条输入（Promise.allSettled 后由快照自带 region 定 key）。 */
export type PetProviderSnapshotEntry =
  | { provider: 'codex'; snapshot: CodexSubscriptionSnapshot }
  | { provider: 'claude'; snapshot: ClaudeSubscriptionSnapshot }
  | { provider: 'cursor'; snapshot: CursorSubscriptionSnapshot }
  | { provider: 'grok'; snapshot: GrokSubscriptionSnapshot }
  | { provider: 'kimi'; snapshot: KimiSubscriptionSnapshot }
  | { provider: 'zcode'; snapshot: ZcodeSubscriptionSnapshot }
  | { provider: 'antigravity'; snapshot: AntigravitySubscriptionSnapshot }
  | { provider: 'qoder'; snapshot: QoderSubscriptionSnapshot }
  | { provider: 'minimax'; snapshot: MiniMaxSubscriptionSnapshot }
  | { provider: 'ark'; snapshot: ArkSubscriptionSnapshot }
  | { provider: 'deepseek'; snapshot: DeepSeekSubscriptionSnapshot }
  | { provider: 'opencode'; snapshot: OpenCodeSubscriptionSnapshot }
  | { provider: 'trae-global'; snapshot: TraeSubscriptionSnapshot }
  | { provider: 'trae-cn'; snapshot: TraeSubscriptionSnapshot }
  | { provider: 'workbuddy-global'; snapshot: WorkBuddySubscriptionSnapshot }
  | { provider: 'workbuddy-mainland'; snapshot: WorkBuddySubscriptionSnapshot };

const KIND_RANK: Record<PetQuotaWindowKind, number> = {
  'five-hour': 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

const MAX_WINDOWS_PER_SECTION = 3;

function finitePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function finiteResetSec(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** 依据窗口 id/label 猜测窗口类别；无法识别的一律 other（不硬凑 5h/周/月）。 */
export function classifyQuotaWindow(id: string, label: string): PetQuotaWindowKind {
  if (id === 'five-hour') return 'five-hour';
  if (id === 'weekly') return 'weekly';
  if (id === 'monthly') return 'monthly';
  const text = `${id} ${label}`.toLowerCase();
  if (/5\s*h|5\s*小时|five[_-]?hour/.test(text)) return 'five-hour';
  if (/7\s*d|7\s*天|周|week/.test(text)) return 'weekly';
  if (/30\s*d|30\s*天|月|month/.test(text)) return 'monthly';
  return 'other';
}

interface RawWindow {
  id: string;
  label: string;
  usedPercent: number;
  resetsAtSec: number | null;
  detail?: string | null;
}

function rateWindow(
  id: string,
  label: string,
  win: { usedPercent: number; resetsAt: number | null },
  detail?: string | null,
): RawWindow {
  return {
    id,
    label,
    usedPercent: win.usedPercent,
    resetsAtSec: win.resetsAt,
    detail: detail ?? null,
  };
}

function toWindow(raw: RawWindow): PetQuotaWindow {
  return {
    id: raw.id,
    label: raw.label,
    kind: classifyQuotaWindow(raw.id, raw.label),
    usedPercent: finitePercent(raw.usedPercent),
    resetsAtSec: finiteResetSec(raw.resetsAtSec),
    detail: raw.detail ?? null,
  };
}

/**
 * 排序窗口：5h → 7d → 30d → 其他；类别内保持入参顺序（稳定）。
 * 没有 5h 的 provider，调用方应让「最敏感」窗口在 other 组中排第一
 * （sortOtherByUsage=true 时 other 组按已用降序）。最后截断到 3 个。
 */
export function orderProviderWindows(
  rawWindows: readonly RawWindow[],
  options: { sortOtherByUsage?: boolean } = {},
): PetQuotaWindow[] {
  const windows = rawWindows.map(toWindow);
  windows.sort((a, b) => {
    const rankDiff = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rankDiff !== 0) return rankDiff;
    if (options.sortOtherByUsage && a.kind === 'other' && a.usedPercent !== b.usedPercent) {
      return b.usedPercent - a.usedPercent;
    }
    return 0;
  });
  return windows.slice(0, MAX_WINDOWS_PER_SECTION);
}

function makeSection(
  provider: PetProviderKey,
  title: string,
  snapshot: { planLabel: string | null; stale?: boolean },
  windows: PetQuotaWindow[],
  tightestPack: PetQuotaTightestPack | null = null,
): PetQuotaProviderSection | null {
  if (windows.length === 0 && tightestPack === null) return null;
  // 无时间窗口但有 tokenPacks（Ark token-only 账号）时造不出 primary，
  // 这种区块没有重点行可展示，宠物气泡直接不渲染（卡片侧仍有 footer）。
  if (windows.length === 0) return null;
  return {
    provider,
    title,
    planLabel: snapshot.planLabel,
    stale: snapshot.stale === true,
    windows,
    primary: windows[0],
    tightestPack,
  };
}

function normalizeLimitsLike<T extends {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: number | null;
}>(
  limits: readonly T[],
  options: { sortOtherByUsage?: boolean; labelMap?: (label: string, id: string) => string } = {},
): PetQuotaWindow[] {
  return orderProviderWindows(
    limits.map((win) => ({
      id: win.id,
      label: options.labelMap ? options.labelMap(win.label, win.id) : win.label,
      usedPercent: win.usedPercent,
      resetsAtSec: win.resetsAt,
    })),
    options,
  );
}

/** 与 AntigravitySubscriptionCard.geminiModelLabel 保持同一裁剪规则。 */
function stripGeminiPrefix(label: string): string {
  return label.replace(/^gemini\s+/i, '') || label;
}

export function normalizeCodexSection(
  snapshot: CodexSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  const raws: RawWindow[] = [];
  if (snapshot.fiveHour) raws.push(rateWindow('five-hour', '5h', snapshot.fiveHour));
  if (snapshot.weekly) raws.push(rateWindow('weekly', '7d', snapshot.weekly));
  return makeSection('codex', 'Codex', snapshot, orderProviderWindows(raws));
}

export function normalizeClaudeSection(
  snapshot: ClaudeSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  const raws: RawWindow[] = [];
  if (snapshot.fiveHour) raws.push(rateWindow('five-hour', '5h', snapshot.fiveHour));
  if (snapshot.sevenDay) raws.push(rateWindow('weekly', '7d', snapshot.sevenDay));
  return makeSection('claude', 'Claude', snapshot, orderProviderWindows(raws));
}

export function normalizeCursorSection(
  snapshot: CursorSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  // Cursor 的窗口是模型桶而非时间窗口（Plan / Cursor 模型 / Other 模型），
  // 没有 5h：按已用百分比降序取最敏感的桶作为重点行。
  const raws: RawWindow[] = [];
  if (snapshot.plan) raws.push(rateWindow('plan', 'Plan', snapshot.plan));
  if (snapshot.cursorModels) {
    raws.push(rateWindow('cursor-models', 'Cursor', snapshot.cursorModels));
  }
  if (snapshot.otherModels) {
    raws.push(rateWindow('other-models', 'Other', snapshot.otherModels));
  }
  return makeSection('cursor', 'Cursor', snapshot, orderProviderWindows(raws, { sortOtherByUsage: true }));
}

export function normalizeGrokSection(
  snapshot: GrokSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  return makeSection('grok', 'Grok', snapshot, normalizeLimitsLike(snapshot.limits));
}

export function normalizeKimiSection(
  snapshot: KimiSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  return makeSection('kimi', 'Kimi Code', snapshot, normalizeLimitsLike(snapshot.limits));
}

export function normalizeZcodeSection(
  snapshot: ZcodeSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  return makeSection('zcode', 'ZCode', snapshot, normalizeLimitsLike(snapshot.limits));
}

export function normalizeAntigravitySection(
  snapshot: AntigravitySubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  // Gemini 按模型给额度，没有 5h：最紧张模型排第一。
  return makeSection(
    'antigravity',
    'Gemini',
    snapshot,
    normalizeLimitsLike(snapshot.limits, {
      sortOtherByUsage: true,
      labelMap: stripGeminiPrefix,
    }),
  );
}

export function normalizeQoderSection(
  snapshot: QoderSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  // Qoder 窗口是 Credits/Add-on 资源池而非时间窗口，最紧张者排第一；
  // 标签与 QoderSubscriptionCard 保持一致：plan→Credits，add-on→Add-on。
  return makeSection(
    'qoder',
    'Qoder',
    snapshot,
    normalizeLimitsLike(snapshot.limits, {
      sortOtherByUsage: true,
      labelMap: (_label, id) => (id === 'plan' ? 'Credits' : 'Add-on'),
    }),
  );
}

export function normalizeMiniMaxSection(
  snapshot: MiniMaxSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  // 单一 fetcher，region 在快照内：title 区分 Minimax / Minimax CN。
  return makeSection(
    'minimax',
    snapshot.region === 'mainland' ? 'Minimax CN' : 'Minimax',
    snapshot,
    normalizeLimitsLike(snapshot.limits),
  );
}

export function normalizeDeepSeekSection(
  snapshot: DeepSeekSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  const windows = orderProviderWindows(
    snapshot.limits.map((win) => ({
      id: win.id,
      label: '余额',
      usedPercent: win.usedPercent,
      resetsAtSec: win.resetsAt,
      detail: win.description,
    })),
    { sortOtherByUsage: true },
  );
  return makeSection('deepseek', 'DeepSeek', snapshot, windows);
}

export function normalizeOpenCodeSection(
  snapshot: OpenCodeSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  return makeSection('opencode', 'OpenCode', snapshot, normalizeLimitsLike(snapshot.limits));
}

export function normalizeTraeSection(
  provider: 'trae-global' | 'trae-cn',
  snapshot: TraeSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  return makeSection(
    provider,
    provider === 'trae-cn' ? 'TRAE CN' : 'TRAE',
    snapshot,
    normalizeLimitsLike(snapshot.limits, { sortOtherByUsage: true }),
  );
}

export function normalizeWorkBuddySection(
  provider: 'workbuddy-global' | 'workbuddy-mainland',
  snapshot: WorkBuddySubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  const isMainland = provider === 'workbuddy-mainland';
  const windows = normalizeLimitsLike(snapshot.limits, {
    sortOtherByUsage: true,
    labelMap: (label) => {
      // 与 WorkBuddySubscriptionCard.workBuddyLabel 同一套双语归一。
      const normalized = label.toLowerCase();
      if (!isMainland) {
        if (normalized === 'credits' || normalized === '积分') return 'Credits';
        if (normalized === 'bonus' || normalized === '赠送') return 'Bonus';
        return label;
      }
      if (normalized === 'credits') return '积分';
      if (normalized === 'bonus') return '赠送';
      return label;
    },
  });
  return makeSection(
    provider,
    isMainland ? 'Workbuddy CN' : 'Workbuddy',
    snapshot,
    windows,
  );
}

function toTightestPack(pack: ArkTokenPack): PetQuotaTightestPack {
  return {
    displayName: pack.displayName,
    label: pack.label,
    remaining: pack.remaining,
    total: pack.total,
  };
}

export function normalizeArkSection(
  snapshot: ArkSubscriptionSnapshot,
): PetQuotaProviderSection | null {
  if (snapshot.status !== 'ready') return null;
  const ordered = orderArkRateLimits(snapshot.limits);
  const windows = orderProviderWindows(
    ordered.map((win) => ({
      id: win.id,
      label: win.label,
      usedPercent: win.usedPercent,
      resetsAtSec: win.resetsAt,
    })),
  );
  const tightest = selectTightestTokenPack(snapshot.tokenPacks);
  return makeSection(
    'ark',
    arkPlanTitle(snapshot.planKind),
    snapshot,
    windows,
    tightest ? toTightestPack(tightest) : null,
  );
}

/** 单条快照分发到对应 mapper；未 ready / 无窗口返回 null。 */
export function normalizeProviderEntry(
  entry: PetProviderSnapshotEntry,
): PetQuotaProviderSection | null {
  switch (entry.provider) {
    case 'codex': return normalizeCodexSection(entry.snapshot);
    case 'claude': return normalizeClaudeSection(entry.snapshot);
    case 'cursor': return normalizeCursorSection(entry.snapshot);
    case 'grok': return normalizeGrokSection(entry.snapshot);
    case 'kimi': return normalizeKimiSection(entry.snapshot);
    case 'zcode': return normalizeZcodeSection(entry.snapshot);
    case 'antigravity': return normalizeAntigravitySection(entry.snapshot);
    case 'qoder': return normalizeQoderSection(entry.snapshot);
    case 'minimax': return normalizeMiniMaxSection(entry.snapshot);
    case 'ark': return normalizeArkSection(entry.snapshot);
    case 'deepseek': return normalizeDeepSeekSection(entry.snapshot);
    case 'opencode': return normalizeOpenCodeSection(entry.snapshot);
    case 'trae-global': return normalizeTraeSection('trae-global', entry.snapshot);
    case 'trae-cn': return normalizeTraeSection('trae-cn', entry.snapshot);
    case 'workbuddy-global': return normalizeWorkBuddySection('workbuddy-global', entry.snapshot);
    case 'workbuddy-mainland':
      return normalizeWorkBuddySection('workbuddy-mainland', entry.snapshot);
  }
}

/**
 * 多 provider 聚合（单一无状态入口）：
 * - 逐家归一化，未 ready/无窗口/上游拉取失败（调用方根本不会传入）的家被跳过；
 * - 区块按重点窗口已用百分比降序稳定排序（最紧张 provider 排最前）；
 * - nextResetSec 取所有窗口中最近的未来重置点；nowMs 由调用方注入。
 */
export function buildPetQuotaAggregate(
  entries: readonly PetProviderSnapshotEntry[],
  nowMs: number = Date.now(),
): PetQuotaAggregate {
  const sections = entries
    .map(normalizeProviderEntry)
    .filter((section): section is PetQuotaProviderSection => section !== null);
  sections.sort((a, b) => {
    if (a.primary.usedPercent !== b.primary.usedPercent) {
      return b.primary.usedPercent - a.primary.usedPercent;
    }
    return 0;
  });
  return {
    sections,
    nextResetSec: selectAggregateNextResetSec(sections, nowMs),
  };
}

/**
 * 极简气泡行（每家一行一个数字）：UI 专用投影，与告警用的完整 sections
 * （含 5h/7d/30d 全窗口）分离——告警展平走 aggregateToQuotaWindows，
 * 宠物气泡只读本模型。
 */
export interface PetQuotaCompactRow {
  key: PetProviderKey;
  title: string;
  /** 套餐档位小字（同行弱化展示，不另占行）；无则 null。 */
  planLabel: string | null;
  /** 重点窗口标签：优先 5h，无 5h 时为退化窗口（Plan/Credits/余额…）。 */
  primaryLabel: string;
  /** 剩余百分比整数（0-100，与订阅卡 clamp(100-used) 口径一致）。 */
  remainingPercent: number;
  /** 重点窗口重置点（epoch 秒）；UI 不展示，仅悬浮 title 可用。 */
  resetsAtSec: number | null;
  stale: boolean;
  /** 恒为 true：投影只输出有有效窗口的家，字段保留以便调用方显式语义。 */
  hasData: boolean;
}

/**
 * 把完整聚合投影成极简行（单一无状态入口）：
 * - 每家只取 primary（有 5h 即 5h，否则已用最高的退化窗口）；
 * - 已用百分比 → 剩余百分比整数（不二次换算，输入已是 clamped used）；
 * - 按剩余升序稳定排序（最危险在前），同值保持 sections 原顺序；
 * - 无数据家本就不在 sections 中；空聚合返回 []（额度区不渲染）。
 */
export function projectToCompactRows(
  aggregate: PetQuotaAggregate,
): PetQuotaCompactRow[] {
  return aggregate.sections.map((section) => {
    const used = finitePercent(section.primary.usedPercent);
    return {
      key: section.provider,
      title: section.title,
      planLabel: section.planLabel,
      primaryLabel: section.primary.label,
      remainingPercent: Math.round(finitePercent(100 - used)),
      resetsAtSec: section.primary.resetsAtSec,
      stale: section.stale,
      hasData: true,
    };
  }).sort((a, b) => {
    if (a.remainingPercent !== b.remainingPercent) {
      return a.remainingPercent - b.remainingPercent;
    }
    return 0;
  });
}

/**
 * 全部区块窗口中最近一个严格晚于 nowMs 的重置点（epoch 秒）。
 * 全部为 null/非有限/已过期时返回 null；nowMs 由调用方注入。
 */
export function selectAggregateNextResetSec(
  sections: readonly PetQuotaProviderSection[],
  nowMs: number,
): number | null {
  let next: number | null = null;
  for (const section of sections) {
    for (const win of section.windows) {
      const sec = win.resetsAtSec;
      if (sec === null || !Number.isFinite(sec)) continue;
      if (sec * 1000 <= nowMs) continue;
      if (next === null || sec < next) next = sec;
    }
  }
  return next;
}

/** 气泡行纯文本投影——可直接喂渲染层；零 React/Electron/DOM 依赖。 */
export interface CompactBubbleRowText {
  /** provider 短名（必现，渲染时 truncate+title）。 */
  title: string;
  /**
   * 套餐档位（Free/Medium 等）：不进气泡正文，仅由渲染层拼进行 title
   * 悬浮文本（`title · planLabel`）；空串归一为 null。
   */
  planLabel: string | null;
  /** 是否标记 stale（仅模型透传供 mood/告警使用；气泡可见文案不带任何后缀）。 */
  stale: boolean;
  /**
   * 重点窗口标签，恒显示（5h/7d/30d/Plan/Credits/余额…）；但与 title
   * 归一化（trim+小写）相同时置 null（消除 `Cursor · Cursor` 这类重复）。
   */
  primaryLabel: string | null;
  /** 剩余百分比整数（与渲染层同号）。 */
  remainingPercent: number;
  /**
   * 重置时刻短形态（GMT+8 具体时钟）：今天 `HH:mm`、今年跨天 `MM-dd`、
   * 跨年 `YY-MM-dd`；resetsAtSec 为 null/过期/无效 → null（不显示）。
   */
  resetShort: string | null;
  /**
   * 完整中文重置文案（含窗口标签 + 具体时刻），如
   * `5h 窗口 今天 16:35 重置` / `5h 窗口 10-14 08:00 重置`；
   * 渲染层放进 title 属性 / aria-label。无重置信息时为 null。
   */
  resetTitle: string | null;
  /** 完整中文 aria-label（含 plan、窗口标签与重置时间，语义完整）。 */
  ariaLabel: string;
}

/** 标签同名归一：trim + 小写；用于消除 title 与 primaryLabel 的重复显示。 */
function sameLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function nonEmptyLabel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 气泡展开区次级窗口行（7d/30d 等 primary 之外的窗口）渲染投影。组件拿到
 * 后直接喂 `SecondaryWindowRow` 渲染：剩余口径与 projectToCompactRows 一致
 * （100 - usedPercent，used 已在归一化层 clamp），短时刻/中文文案复用订阅卡
 * 同款格式化器。
 */
export interface SecondaryRowView {
  label: string;
  remainingPercent: number;
  resetShort: string | null;
  resetTitle: string | null;
  ariaLabel: string;
}

/**
 * 把一家的非 primary 窗口（归一化层保证 primary 恒为 windows[0]，至多 3 个）
 * 投影成展开区小字行（5h 之外的窗口，至多 2 条 = windows.slice(1, 3)）：
 * - 剩余 = round(100 - usedPercent)，与 projectToCompactRows 口径一致；
 * - 短时刻 `HH:mm` / `MM-dd` / `YY-MM-dd` 走订阅卡同款格式化器（GMT+8）；
 * - 完整中文进 resetTitle，悬浮 / aria-label 可读；
 * - 纯函数：不读系统时钟、不修改入参 windows（slice 已是 copy）；
 * - stale 透传：section.stale 由调用方/mood 层消费，本函数只读窗口字段，
 *   对 stale 无感（不写回、不影响展开行为）。
 *
 * 命名 `FromWindows` 强调输入是 windows 数组（与 `projectToCompactRows`
 * 接 `PetQuotaAggregate` 形成对照），避免调用方误传整段 section。
 */
export function projectSecondaryRowsFromWindows(
  windows: readonly PetQuotaWindow[],
  nowSec: number,
): SecondaryRowView[] {
  return windows.slice(1, 3).map((win) => {
    const label = win.label.trim();
    const remainingPercent = Math.round(100 - win.usedPercent);
    const resetShort = formatResetCountdownShort(win.resetsAtSec, nowSec);
    const resetZh = formatResetCountdownZh(win.resetsAtSec, nowSec);
    const resetTitle = resetZh
      ? label ? `${label} 窗口 ${resetZh}` : resetZh
      : null;
    const suffix = label ? `${label} 窗口剩余` : '剩余';
    const ariaLabel = resetZh
      ? `剩余 ${remainingPercent}%，${label ? `${label} 窗口 ` : ''}${resetZh}`
      : `${suffix} ${remainingPercent}%`;
    return { label, remainingPercent, resetShort, resetTitle, ariaLabel };
  });
}

/**
 * 极简气泡行纯格式化（与 PetQuotaCompactRow 一一对应，可在 node:test 单测）：
 * - primaryLabel 恒显示，除非与 title 归一化后同名（如 Cursor 的 primary
 *   窗口标签就是 "Cursor"）——同名置 null，避免 `Cursor · Cursor`；
 * - planLabel（Free/Medium 等）不进正文，仅由渲染层拼进行 title 悬浮；
 * - 重置时刻短形态 `HH:mm`（今天）/ `MM-dd`（今年跨天）/ `YY-MM-dd`（跨年，
 *   GMT+8），完整中文 `5h 窗口 今天 16:35 重置` 进 resetTitle 与 aria-label。
 */
export function formatCompactBubbleRow(
  row: PetQuotaCompactRow,
  nowSec: number,
): CompactBubbleRowText {
  const resetShort = formatResetCountdownShort(row.resetsAtSec, nowSec);
  const resetZh = formatResetCountdownZh(row.resetsAtSec, nowSec);
  const planLabel = nonEmptyLabel(row.planLabel);
  const rawLabel = row.primaryLabel.trim();
  const primaryLabel = rawLabel !== '' && !sameLabel(rawLabel, row.title) ? rawLabel : null;
  const resetTitle = resetZh
    ? primaryLabel ? `${primaryLabel} 窗口 ${resetZh}` : resetZh
    : null;
  const planPart = planLabel ? ` ${planLabel}` : '';
  const suffix = primaryLabel ? `${primaryLabel} 窗口剩余` : '剩余';
  const base = `${row.title}${planPart} ${suffix} ${row.remainingPercent}%`;
  const ariaLabel = resetZh ? `${base}，${resetZh}` : base;
  return {
    title: row.title,
    planLabel,
    stale: row.stale,
    primaryLabel,
    remainingPercent: row.remainingPercent,
    resetShort,
    resetTitle,
    ariaLabel,
  };
}
