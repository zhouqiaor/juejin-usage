// SPDX-License-Identifier: MIT
// main/pc-bridge-schema.ts
//
// D4 PC-bridge MVP：冻结的 v1 HTTP 契约（见
// tools/quota-app-android/docs/DESIGN-2026-09-17-pcbridge-mvp.md §2）。
//
// 本文件只承载「core 现有 UsageSummary（窗口级数组 bySource）→ bridge v1 载荷」的
// 纯映射，不引用 electron / node:http，可在 node:test 中直接单测。
// PC 测试与 Android JVM 测试共用同一份 fixture JSON 字面量（两端对齐）。
import type { HourlyUsageRow, UsageSummary } from '@juejin-opensource/jusage-core';

/** bridge 契约版本（与 core daily-sealed 版本无关；Android 端只接受 1）。 */
export const PC_BRIDGE_CONTRACT_VERSION = 1;

export interface PcBridgeSourceStatV1 {
  tokens: number;
  costUsd: number;
}

export interface PcBridgeTodayV1 {
  /** stats 时区本地日期 YYYY-MM-DD */
  date: string;
  totalTokens: number;
  totalCostUsd: number;
  /** source → 今日 tokens/费用（由当日 hourly 行聚合，key 为 CLI 来源名） */
  bySource: Record<string, PcBridgeSourceStatV1>;
  /** v1 恒为空数组：core summary 不输出项目维度，预留 v2 */
  topProjects: [];
}

export interface PcBridgeSummaryV1 {
  version: 1;
  /** 快照生成时刻，ISO-8601 UTC */
  asOf: string;
  today: PcBridgeTodayV1;
}

/** 两端测试共用的同一报文（字段顺序不影响 JSON.parse 深相等）。 */
export const V1_FIXTURE: PcBridgeSummaryV1 = {
  version: 1,
  asOf: '2026-09-17T08:00:00.000Z',
  today: {
    date: '2026-09-17',
    totalTokens: 1234,
    totalCostUsd: 0.12,
    bySource: {
      codex: { tokens: 1000, costUsd: 0.1 },
      workbuddy: { tokens: 234, costUsd: 0.02 },
    },
    topProjects: [],
  },
};

/** 本地时区 YYYY-MM-DD（与 core「今日」口径一致：按本地日历日）。 */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 从 hourly 行推断「今日」日期：取出现过的最大日期（hourly 已按 stats 时区切日，
 * 通常就是当天）；无行时回退调用方给定的本地日期。
 */
export function resolveTodayDate(hours: readonly HourlyUsageRow[], fallback: string): string {
  let max = '';
  for (const h of hours) {
    if (h.date > max) max = h.date;
  }
  return max || fallback;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * core UsageSummary + 当日 hourly 行 → bridge v1 载荷。
 * - 今日 totals 以 core summary 的 todayTokens/todayCostUsd 为权威值；
 * - bySource 由当日 hourly 行按 source 聚合（core summary 的 bySource 是 statsSince
 *   窗口级、非今日，不能直接复用）；
 * - topProjects v1 恒空。
 */
export function toBridgeSummaryV1(input: {
  core: UsageSummary;
  hours: readonly HourlyUsageRow[];
  todayDate: string;
  asOf?: Date;
}): PcBridgeSummaryV1 {
  const agg = new Map<string, PcBridgeSourceStatV1>();
  for (const h of input.hours) {
    if (h.date !== input.todayDate) continue;
    const cur = agg.get(h.source) ?? { tokens: 0, costUsd: 0 };
    cur.tokens += h.tokens;
    cur.costUsd += h.costUsd;
    agg.set(h.source, cur);
  }
  const bySource: Record<string, PcBridgeSourceStatV1> = {};
  // 按 tokens 降序写入（object 键序即给 Android 的呈现顺序，Android 侧仍会再排序）
  for (const [source, stat] of [...agg.entries()].sort((a, b) => b[1].tokens - a[1].tokens)) {
    bySource[source] = { tokens: stat.tokens, costUsd: round2(stat.costUsd) };
  }
  return {
    version: PC_BRIDGE_CONTRACT_VERSION,
    asOf: (input.asOf ?? new Date()).toISOString(),
    today: {
      date: input.todayDate,
      totalTokens: input.core.todayTokens,
      totalCostUsd: input.core.todayCostUsd,
      bySource,
      topProjects: [],
    },
  };
}
