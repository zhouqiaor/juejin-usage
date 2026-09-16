// SPDX-License-Identifier: MIT
// main/ark-subscription-ipc.ts -- Ark subscription IPC channel
import { ipcMain } from 'electron';
import { readArkSubscription } from './ark-subscription';

export const ARK_SUBSCRIPTION_GET_CHANNEL = 'ark-subscription:get';

export function registerArkSubscriptionIpc(): () => void {
  ipcMain.removeHandler(ARK_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(ARK_SUBSCRIPTION_GET_CHANNEL, (_e, options?: { forceRefresh?: boolean }) =>
    readArkSubscription(options ?? {}),
  );
  return () => ipcMain.removeHandler(ARK_SUBSCRIPTION_GET_CHANNEL);
}