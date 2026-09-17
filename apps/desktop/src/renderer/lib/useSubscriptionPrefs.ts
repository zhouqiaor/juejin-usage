// SPDX-License-Identifier: MIT
// renderer/lib/useSubscriptionPrefs.ts — 三家订阅开关的 renderer 镜像
//
// 首次挂载拉取（main 的 get 处理器会先跑完一次性迁移），之后跟随
// subscription-prefs:changed 广播即时更新（切换开关 / 凭据保存都会触发）。
//
// 防御：main/preload 改动不随 renderer HMR 热更，开发期会出现「新 renderer +
// 旧 preload」中间态，此时 window.tud.getSubscriptionPrefs 尚不存在。缺桥接时
// 按旧行为降级为三家全开，保证组件树不崩（IPC 真的 reject 才 fail-closed 全关）。
import { useEffect, useState } from 'react';
import {
  DEFAULT_SUBSCRIPTION_PREFS,
  type SubscriptionPrefs,
} from '../../shared/subscription-prefs';

const LEGACY_ALL_ENABLED_PREFS: SubscriptionPrefs = {
  cursor: true,
  minimax: true,
  ark: true,
  migratedAt: null,
};

export function readSubscriptionPrefs(): Promise<SubscriptionPrefs> {
  if (typeof window.tud?.getSubscriptionPrefs !== 'function') {
    return Promise.resolve(LEGACY_ALL_ENABLED_PREFS);
  }
  return window.tud
    .getSubscriptionPrefs()
    .catch(() => DEFAULT_SUBSCRIPTION_PREFS);
}

export function subscribeSubscriptionPrefs(
  callback: (prefs: SubscriptionPrefs) => void,
): () => void {
  if (typeof window.tud?.onSubscriptionPrefsChanged !== 'function') {
    return () => {};
  }
  return window.tud.onSubscriptionPrefsChanged(callback);
}

export function useSubscriptionPrefs(): SubscriptionPrefs {
  const [prefs, setPrefs] = useState<SubscriptionPrefs>(DEFAULT_SUBSCRIPTION_PREFS);

  useEffect(() => {
    let cancelled = false;
    void readSubscriptionPrefs().then((value) => {
      if (!cancelled) setPrefs(value);
    });
    const unsubscribe = subscribeSubscriptionPrefs((value) => {
      if (!cancelled) setPrefs(value);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return prefs;
}
