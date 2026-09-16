// SPDX-License-Identifier: MIT
// shared/ark-token-packs.ts — 火山方舟免费推理额度折叠/汇总纯逻辑（零 React/heroui 依赖，node:test 可直接测）
import type { ArkTokenPack } from './ark-subscription';

/** >= 该模型数才折叠为单条汇总；0/1 个模型直接展示明细，无需折叠 */
export const COLLAPSE_MODEL_THRESHOLD = 2;

/**
 * 折叠汇总行数据来源口径（HTML title 文案，用户口径：不暴露内部接口名）。
 * 数据为火山方舟控制面免费推理额度 + 免费推理资源包（含协作奖励返还），不含付费 Token 套餐。
 */
export const TOKEN_PACKS_SOURCE_TOOLTIP =
  '数据来自火山方舟控制面的免费推理额度与免费推理资源包（含协作奖励返还），不含付费购买的 Token 套餐；不同模型的 Token 直接相加为粗口径汇总，仅展示总量';

function trimOneDecimal(x: number): string {
  return String(Math.round(x * 10) / 10);
}

/** 去重模型数：一个模型可有「免费额度」+「资源包」两个池（两行），行数 ≠ 模型数 */
export function countArkTokenModels(packs: readonly { model: string }[]): number {
  return new Set(packs.map((p) => p.model)).size;
}

/** token 数中文自适应格式化：>=1 亿显示 x.x亿，>=1 万显示 x.x万；负数保留负号（过期降档） */
export function formatArkTokenCount(n: number): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  let text: string;
  if (abs >= 1e8) text = trimOneDecimal(abs / 1e8) + '亿';
  else if (abs >= 1e4) text = trimOneDecimal(abs / 1e4) + '万';
  else text = String(Math.round(abs));
  return neg ? '-' + text : text;
}

export interface ArkTokenPacksSummary {
  /** 去重模型数（非池/行数）：同一模型的免费额度+资源包只算 1 个模型 */
  modelCount: number;
  totalConsumed: number;
  totalRemaining: number;
  total: number;
  /** sum(consumed)/sum(total)*100，保留两位小数；total<=0 为 null。**不 clamp**：过期降档时 remaining 为负、该值可 >100 */
  usedPct: number | null;
}

/**
 * 折叠态汇总纯计算。
 * 口径说明：不同模型的 token 计价/权重不同，直接相加是粗口径汇总，仅用于展示总体余量，
 * 不做跨模型额度等价换算；remaining 可能为负（过期降档 consumed>total），不 clamp。
 */
export function summarizeArkTokenPacks(packs: readonly ArkTokenPack[]): ArkTokenPacksSummary {
  let totalConsumed = 0;
  let total = 0;
  for (const pack of packs) {
    // total<=0 的池子不纳入汇总（与 shared 映射层跳过口径一致）
    if (!(pack.total > 0)) continue;
    totalConsumed += pack.consumed;
    total += pack.total;
  }
  const totalRemaining = total - totalConsumed;
  const usedPct =
    total > 0 ? Math.round((totalConsumed / total) * 10000) / 100 : null;
  return { modelCount: countArkTokenModels(packs), totalConsumed, totalRemaining, total, usedPct };
}

/** >=2 个去重模型才折叠汇总；0/1 个模型（即使双池两行）直接展示明细 */
export function shouldCollapseTokenPacks(packs: readonly { model: string }[]): boolean {
  return countArkTokenModels(packs) >= COLLAPSE_MODEL_THRESHOLD;
}
