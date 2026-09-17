// SPDX-License-Identifier: MIT
// shared/pet-quota-integration.ts — 桌面宠物视图（DesktopPetView）集成用的零框架纯逻辑
//
// 军规（exec.md §7）：把「会出错」的归一化映射放在核心层单测，视图组件只做
// I/O 与编排。不 import React/Electron/DOM。
import type { ArkSubscriptionSnapshot } from './ark-subscription.js';
import type { PetMoodInput } from './pet-mood.js';
import type { PetQuotaAggregate } from './pet-quota-providers.js';
import type { QuotaWindow } from './pet-quota-alert.js';

/** Ark 快照映射用的 provider key；多 provider 时 evaluateQuotaAlerts 的 key 也以此区分。 */
export const ARK_PROVIDER = 'ark';

/**
 * 把 Ark 订阅快照的速率窗口归一化为告警状态机输入。
 *
 * 多 provider 扩展点（MVP 边界）：后续各 *Subscription 快照只要各自提供一个
 * 类似的 `→ QuotaWindow[]` 映射，视图层把数组合并后喂给同一个
 * evaluateQuotaAlerts 即可，状态机/冷却/迟滞逻辑无需改动。
 *
 * 注意单位：ArkRateLimitWindow.resetsAt 是 epoch **秒**（见 ark-subscription
 * 的 parseReset），而 QuotaWindow 与 evaluateQuotaAlerts 统一使用 epoch
 * **毫秒**（与 Date.now() 比较），此处是唯一的换算点。
 */
export function arkSnapshotToQuotaWindows(
  snapshot: ArkSubscriptionSnapshot,
): QuotaWindow[] {
  return snapshot.limits.map((win) => ({
    provider: ARK_PROVIDER,
    id: win.id,
    usedPercent: win.usedPercent,
    resetsAt:
      typeof win.resetsAt === 'number' && Number.isFinite(win.resetsAt)
        ? win.resetsAt * 1000
        : null,
  }));
}

/**
 * 多 provider 聚合快照 → 告警状态机输入（单一换算点：epoch 秒 → 毫秒）。
 * provider key 已天然唯一（trae/workbuddy 带区后缀），evaluateQuotaAlerts
 * 的 `${provider}::${id}` key 不会跨家碰撞。
 */
export function aggregateToQuotaWindows(aggregate: PetQuotaAggregate): QuotaWindow[] {
  return aggregate.sections.flatMap((section) =>
    section.windows.map((win) => ({
      provider: section.provider,
      id: win.id,
      usedPercent: win.usedPercent,
      resetsAt:
        typeof win.resetsAtSec === 'number' && Number.isFinite(win.resetsAtSec)
          ? win.resetsAtSec * 1000
          : null,
    })),
  );
}

/**
 * 多 provider 聚合快照 → pet-mood 情绪层输入（默认对 aggregate 中**全部**
 * section 评估；Ark 不再是唯一情绪数据源）。
 *
 * 与 aggregateToQuotaWindows 的关键差异（不可互喂，见 pet-m0 接线方案 §1.2）：
 * - resetsAt 保持 epoch **秒**（直接读 resetsAtSec），pet-mood 用 nowSec，
 *   不做 ×1000/÷1000 往返；
 * - 丢弃 'other' 窗口（cursor Plan 桶 / qoder Credits / deepseek 余额等），
 *   情绪只认 5h/weekly/monthly——只有退化窗口的家自然不参与情绪决胜；
 * - PetQuotaAggregate 没有全局 status/stale，这里合成：
 *   · 选中 section 为 0（无任何已配置且有数据的家，或显式 providers 白名单
 *     过滤光——含未配置/token-only 账号：token-only 账号在归一化层就不生成
 *     section，见 pet-quota-providers.makeSection）→ 'not-configured'
 *     （pet-mood 据此判 unknown，「没数据」绝不演成「耗尽」）；
 *   · stale 取选中 section **全部**皆 stale——有任一 fresh 即不报 unknown，
 *     新鲜别家的窗口照常参与情绪决胜。
 *
 * 跨家决胜（百分比优先；并列时窗口 5h > weekly > monthly；再并列按输入
 * 顺序）不在此重复实现：本函数只按 aggregate.sections 原顺序展平窗口，
 * 决胜统一由 resolvePetMood 的 tighterOf 完成（见 pet-mood.ts）。sections
 * 在 buildPetQuotaAggregate 中按 primary 已用百分比降序稳定排序，故完全
 * 并列时驱动情绪的 provider 也是确定的。
 *
 * providers 显式参数仅供测试/未来白名单使用：
 * - 省略（undefined）→ 评估全部 section（生产默认）；
 * - 传数组（含 []）→ 只评估名单内的家，[] 等价于无 section（not-configured）。
 *
 * 返回全新对象/数组（窗口也是新映射出来的）：QA 临时改百分比或渲染层任何
 * 误改都不会回灌 aggregate、污染气泡展示。
 */
export function aggregateToMoodInput(
  aggregate: PetQuotaAggregate,
  providers?: readonly string[],
): Pick<PetMoodInput, 'windows' | 'status' | 'stale'> {
  const sections = providers
    ? aggregate.sections.filter((section) => providers.includes(section.provider))
    : aggregate.sections;
  return {
    status: sections.length > 0 ? 'ready' : 'not-configured',
    stale: sections.length > 0 && sections.every((section) => section.stale),
    windows: sections.flatMap((section) =>
      section.windows.flatMap((win) => {
        if (
          win.kind !== 'five-hour'
          && win.kind !== 'weekly'
          && win.kind !== 'monthly'
        ) {
          return [];
        }
        return [{
          provider: section.provider,
          id: win.kind,
          usedPercent: win.usedPercent,
          resetsAt: win.resetsAtSec,
        }];
      }),
    ),
  };
}
