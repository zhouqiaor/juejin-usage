// SPDX-License-Identifier: MIT
// shared/pet-quota-integration.ts — 桌面宠物视图（DesktopPetView）集成用的零框架纯逻辑
//
// 军规（exec.md §7）：把「会出错」的归一化映射放在核心层单测，视图组件只做
// I/O 与编排。不 import React/Electron/DOM。
import type { ArkSubscriptionSnapshot } from './ark-subscription.js';
import type { PetQuotaAggregate } from './pet-quota-providers.js';
import type { QuotaWindow } from './pet-quota-alert.js';

/** MVP 只接 Ark；多 provider 时 evaluateQuotaAlerts 的 key 以此区分。 */
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
