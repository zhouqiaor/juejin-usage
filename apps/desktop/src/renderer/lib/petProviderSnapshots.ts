// SPDX-License-Identifier: MIT
// renderer/lib/petProviderSnapshots.ts — 宠物气泡多 provider 套餐快照聚合拉取
//
// 纯编排、无缓存状态：main 侧每家 get*Subscription 自带 60s 缓存，
// 这里只负责一次 Promise.allSettled 并发扇出（单家失败/未配置不影响其他家）。
// 归一化/排序等会出错的逻辑全部在 shared/pet-quota-providers.ts。
import type { PetProviderSnapshotEntry } from '../../shared/pet-quota-providers';
import type { SubscriptionProviderKey } from '../../shared/subscription-prefs';

type DistributiveFetcher<E extends PetProviderSnapshotEntry> = E extends unknown
  ? {
      provider: E['provider'];
      fetch: (force: boolean) => Promise<E['snapshot']>;
    }
  : never;

export type PetProviderFetcher = DistributiveFetcher<PetProviderSnapshotEntry>;

const forceOptions = (force: boolean): { forceRefresh: true } | undefined =>
  force ? { forceRefresh: true } : undefined;

/**
 * 顺序即「同紧张度时的稳定展示顺序」；归一化后再按重点窗口已用比例重排。
 * 不支持 forceRefresh 入参的通道（codex/cursor/grok/kimi/zcode/antigravity）
 * 本来就无 main 缓存或按自身节奏刷新，直接无参调用。
 */
const FETCHERS: readonly PetProviderFetcher[] = [
  { provider: 'codex', fetch: () => window.tud.getCodexSubscription() },
  {
    provider: 'claude',
    fetch: (force) => window.tud.getClaudeSubscription(force ? { forceRefresh: true } : undefined),
  },
  { provider: 'cursor', fetch: () => window.tud.getCursorSubscription() },
  { provider: 'grok', fetch: () => window.tud.getGrokSubscription() },
  { provider: 'kimi', fetch: () => window.tud.getKimiSubscription() },
  { provider: 'zcode', fetch: () => window.tud.getZcodeSubscription() },
  { provider: 'antigravity', fetch: () => window.tud.getAntigravitySubscription() },
  { provider: 'qoder', fetch: () => window.tud.getQoderSubscription() },
  {
    provider: 'minimax',
    fetch: (force) => window.tud.getMiniMaxSubscription(forceOptions(force)),
  },
  { provider: 'ark', fetch: (force) => window.tud.getArkSubscription(forceOptions(force)) },
  {
    provider: 'deepseek',
    fetch: (force) => window.tud.getDeepSeekSubscription(forceOptions(force)),
  },
  {
    provider: 'opencode',
    fetch: (force) => window.tud.getOpenCodeSubscription(forceOptions(force)),
  },
  {
    provider: 'trae-global',
    fetch: (force) => window.tud.getTraeGlobalSubscription(forceOptions(force)),
  },
  {
    provider: 'trae-cn',
    fetch: (force) => window.tud.getTraeCnSubscription(forceOptions(force)),
  },
  {
    provider: 'workbuddy-global',
    fetch: (force) => window.tud.getWorkBuddyGlobalSubscription(forceOptions(force)),
  },
  {
    provider: 'workbuddy-mainland',
    fetch: (force) => window.tud.getWorkBuddyMainlandSubscription(forceOptions(force)),
  },
];

export interface PetProviderFetchOutcome {
  entries: PetProviderSnapshotEntry[];
  /** 至少一家 reject（未配置/鉴权失败/超时）；调用方只 warn 一次。 */
  hadFailure: boolean;
}

/**
 * 并发拉取全部 provider 快照。单家失败被隔离（Promise.allSettled），
 * 成功一家就进 entries 一家；全失败时 entries 为空，额度区不渲染。
 *
 * enabledKeys：受「设置-余量凭证」开关控制的三家（cursor/minimax/ark）。
 * 不在集合内的家根本不会进入 Promise.allSettled —— 关闭 = 不发任何 IPC/网络请求。
 */
export async function fetchPetProviderSnapshots(
  force = false,
  enabledKeys?: ReadonlySet<SubscriptionProviderKey>,
): Promise<PetProviderFetchOutcome> {
  const gated = new Set<SubscriptionProviderKey>(['cursor', 'minimax', 'ark']);
  const activeFetchers = FETCHERS.filter((fetcher) => {
    if (!gated.has(fetcher.provider as SubscriptionProviderKey)) return true;
    return enabledKeys?.has(fetcher.provider as SubscriptionProviderKey) === true;
  });
  const results = await Promise.allSettled(
    activeFetchers.map(async (fetcher) => {
      const snapshot = await fetcher.fetch(force);
      // 联合分发：键与快照类型成对构造，归一化侧再按 provider switch。
      return { provider: fetcher.provider, snapshot } as PetProviderSnapshotEntry;
    }),
  );
  const entries: PetProviderSnapshotEntry[] = [];
  let hadFailure = false;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      entries.push(result.value);
    } else {
      hadFailure = true;
    }
  }
  return { entries, hadFailure };
}
