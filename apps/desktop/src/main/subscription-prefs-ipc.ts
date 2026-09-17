// SPDX-License-Identifier: MIT
// main/subscription-prefs-ipc.ts -- 三家订阅开关 IPC + 首次启动一次性可用性迁移
//
// 迁移只读本机凭据（env / safeStorage keystore / ~/.minimax-code / opencode
// auth.json / Cursor state.vscdb），不发任何网络请求；探测到即默认开启并落
// migratedAt 戳记。迁移之后严格尊重用户选择（见 shared/subscription-prefs）。
import { ipcMain } from 'electron';
import {
  loadStoredSubscriptionPrefs,
  loadSubscriptionPrefs,
  saveSubscriptionPrefs,
} from './autostart';
import {
  SUBSCRIPTION_PREFS_GET_CHANNEL,
  SUBSCRIPTION_PREFS_SET_CHANNEL,
  patchSubscriptionPrefs,
  resolveSubscriptionPrefs,
  type SubscriptionAvailability,
  type SubscriptionPrefs,
} from '../shared/subscription-prefs';
import { hasCursorCredentials } from './cursor-subscription';
import {
  readMiniMaxLocalCredentials,
  readMiniMaxOpenCodeAuth,
} from './minimax-subscription';
import { resolveMiniMaxCredentials, resolveArkCredentials } from './subscription-keystore';

/** 本机可用性探测：全部为只读本地检查，不发网络请求。 */
export async function probeSubscriptionAvailability(): Promise<SubscriptionAvailability> {
  const [cursor, keystoreMiniMax, localMiniMax, openCodeMiniMax, arkCreds] = await Promise.all([
    hasCursorCredentials().catch(() => false),
    // resolveMiniMaxCredentials 是同步函数（env + 加密文件），包成 Promise.all 成员
    Promise.resolve(resolveMiniMaxCredentials() !== null),
    readMiniMaxLocalCredentials().then((c) => c !== null).catch(() => false),
    readMiniMaxOpenCodeAuth().then((c) => c !== null).catch(() => false),
    Promise.resolve(resolveArkCredentials() !== null),
  ]);
  return {
    cursor,
    minimax: keystoreMiniMax || localMiniMax || openCodeMiniMax,
    ark: arkCreds,
  };
}

let migrationTask: Promise<SubscriptionPrefs> | null = null;

/**
 * 首次读到无 subscriptionPrefs 的安装时做一次性迁移；已迁移则直接返回。
 * 并发首次 get 共用同一个探测 Promise（只读探测本身幂等，去重避免重复开库）。
 */
export function ensureSubscriptionPrefsMigrated(): Promise<SubscriptionPrefs> {
  if (migrationTask) return migrationTask;
  migrationTask = (async () => {
    const stored = await loadStoredSubscriptionPrefs();
    if (stored) return stored;
    const availability = await probeSubscriptionAvailability();
    const resolved = resolveSubscriptionPrefs(
      null,
      availability,
      new Date().toISOString(),
    );
    // saveSubscriptionPrefs 会广播；启动期无窗口时广播自然为空操作。
    return saveSubscriptionPrefs(resolved);
  })().catch((error) => {
    // 探测/落盘失败不应卡死 get：回落全关默认值，下次 get 重试（不落戳）。
    migrationTask = null;
    console.error(
      '[subscription-prefs] migration probe failed:',
      error instanceof Error ? error.message : error,
    );
    return loadSubscriptionPrefs();
  });
  return migrationTask;
}

export function registerSubscriptionPrefsIpc(): () => void {
  ipcMain.removeHandler(SUBSCRIPTION_PREFS_GET_CHANNEL);
  ipcMain.removeHandler(SUBSCRIPTION_PREFS_SET_CHANNEL);

  ipcMain.handle(SUBSCRIPTION_PREFS_GET_CHANNEL, async () => {
    await ensureSubscriptionPrefsMigrated();
    return loadSubscriptionPrefs();
  });

  ipcMain.handle(
    SUBSCRIPTION_PREFS_SET_CHANNEL,
    async (_event, patch: unknown) => {
      await ensureSubscriptionPrefsMigrated();
      const current = await loadSubscriptionPrefs();
      const next = patchSubscriptionPrefs(current, patch);
      // 无实际变化也回当前值（幂等成功语义），切换即保存即广播由 save 完成。
      return next ? saveSubscriptionPrefs(next) : current;
    },
  );

  return () => {
    ipcMain.removeHandler(SUBSCRIPTION_PREFS_GET_CHANNEL);
    ipcMain.removeHandler(SUBSCRIPTION_PREFS_SET_CHANNEL);
  };
}
