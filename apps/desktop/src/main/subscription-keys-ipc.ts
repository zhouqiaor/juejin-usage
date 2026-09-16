// SPDX-License-Identifier: MIT
// main/subscription-keys-ipc.ts
import { ipcMain } from 'electron';
import { clearKeys, getKeyStatus, saveKeys, type SubscriptionKeyStore } from './subscription-keystore';

export const SUBSCRIPTION_KEYS_GET_STATUS_CHANNEL = 'subscription-keys:get-status';
export const SUBSCRIPTION_KEYS_SAVE_CHANNEL = 'subscription-keys:save';
export const SUBSCRIPTION_KEYS_CLEAR_CHANNEL = 'subscription-keys:clear';

export function registerSubscriptionKeysIpc(): () => void {
  ipcMain.removeHandler(SUBSCRIPTION_KEYS_GET_STATUS_CHANNEL);
  ipcMain.removeHandler(SUBSCRIPTION_KEYS_SAVE_CHANNEL);
  ipcMain.removeHandler(SUBSCRIPTION_KEYS_CLEAR_CHANNEL);

  ipcMain.handle(SUBSCRIPTION_KEYS_GET_STATUS_CHANNEL, () => ({ success: true, message: '', data: getKeyStatus() }));

  ipcMain.handle(SUBSCRIPTION_KEYS_SAVE_CHANNEL, (_event, keys: SubscriptionKeyStore) => {
    const cleaned: SubscriptionKeyStore = {};
    if (keys.minimax) {
      const k = (keys.minimax.apiKey ?? '').trim();
      if (k) cleaned.minimax = { apiKey: k, region: keys.minimax.region };
    }
    if (keys.ark) {
      const ak = (keys.ark.accessKeyId ?? '').trim();
      const sk = (keys.ark.secretAccessKey ?? '').trim();
      if (ak && sk) cleaned.ark = { accessKeyId: ak, secretAccessKey: sk, region: keys.ark.region };
    }
    return saveKeys(cleaned);
  });

  ipcMain.handle(SUBSCRIPTION_KEYS_CLEAR_CHANNEL, (_event, plan: 'minimax' | 'ark') => clearKeys(plan));

  return () => {
    ipcMain.removeHandler(SUBSCRIPTION_KEYS_GET_STATUS_CHANNEL);
    ipcMain.removeHandler(SUBSCRIPTION_KEYS_SAVE_CHANNEL);
    ipcMain.removeHandler(SUBSCRIPTION_KEYS_CLEAR_CHANNEL);
  };
}
