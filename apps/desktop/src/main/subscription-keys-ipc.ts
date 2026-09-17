// SPDX-License-Identifier: MIT
// main/subscription-keys-ipc.ts
import { ipcMain } from 'electron';
import { clearKeys, getKeyStatus, saveKeys, type SubscriptionKeyStore } from './subscription-keystore';
import { validateArkAccessKeyIdForSave } from '../shared/ark-credentials';
import { broadcastSubscriptionPrefs, loadSubscriptionPrefs } from './autostart';

export const SUBSCRIPTION_KEYS_GET_STATUS_CHANNEL = 'subscription-keys:get-status';
export const SUBSCRIPTION_KEYS_SAVE_CHANNEL = 'subscription-keys:save';
export const SUBSCRIPTION_KEYS_CLEAR_CHANNEL = 'subscription-keys:clear';

/**
 * 凭据落盘后广播一次订阅 prefs（载荷不变也发）：让所有窗口（含独立 origin 的
 * pet.html）把这当作「凭据可能变了」信号立即重轮询；卡片显隐仍以开关为准。
 */
async function notifyPrefsAfterCredentialChange(): Promise<void> {
  try {
    broadcastSubscriptionPrefs(await loadSubscriptionPrefs());
  } catch {
    // prefs 尚未迁移/不可读时凭据保存仍应成功，广播失败仅忽略。
  }
}

export function registerSubscriptionKeysIpc(): () => void {
  ipcMain.removeHandler(SUBSCRIPTION_KEYS_GET_STATUS_CHANNEL);
  ipcMain.removeHandler(SUBSCRIPTION_KEYS_SAVE_CHANNEL);
  ipcMain.removeHandler(SUBSCRIPTION_KEYS_CLEAR_CHANNEL);

  ipcMain.handle(SUBSCRIPTION_KEYS_GET_STATUS_CHANNEL, () => ({ success: true, message: '', data: getKeyStatus() }));

  ipcMain.handle(SUBSCRIPTION_KEYS_SAVE_CHANNEL, async (_event, keys: SubscriptionKeyStore) => {
    const cleaned: SubscriptionKeyStore = {};
    if (keys.minimax) {
      const k = (keys.minimax.apiKey ?? '').trim();
      if (k) cleaned.minimax = { apiKey: k, region: keys.minimax.region };
    }
    if (keys.ark) {
      const ak = (keys.ark.accessKeyId ?? '').trim();
      const sk = (keys.ark.secretAccessKey ?? '').trim();
      // 只拦 UI 手输保存通道：env 来源在 resolveArkCredentials 直读，不经过这里
      const akError = validateArkAccessKeyIdForSave(ak);
      if (akError) return { success: false, message: akError };
      if (ak && sk) cleaned.ark = { accessKeyId: ak, secretAccessKey: sk, region: keys.ark.region };
    }
    const result = saveKeys(cleaned);
    if (result.success) await notifyPrefsAfterCredentialChange();
    return result;
  });

  ipcMain.handle(SUBSCRIPTION_KEYS_CLEAR_CHANNEL, async (_event, plan: 'minimax' | 'ark') => {
    const result = clearKeys(plan);
    await notifyPrefsAfterCredentialChange();
    return result;
  });

  return () => {
    ipcMain.removeHandler(SUBSCRIPTION_KEYS_GET_STATUS_CHANNEL);
    ipcMain.removeHandler(SUBSCRIPTION_KEYS_SAVE_CHANNEL);
    ipcMain.removeHandler(SUBSCRIPTION_KEYS_CLEAR_CHANNEL);
  };
}
