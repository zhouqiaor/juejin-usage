// SPDX-License-Identifier: MIT
// main/plan-balance-ipc.ts — 注册 plan_balance 3 个 IPC channel
//
// 模式：仿 codex-subscription-ipc.ts / antigravity-subscription-ipc.ts
// 范围：preload 暴露的 3 个方法在此注册 main handler
import { ipcMain } from 'electron';
import { PLAN_BALANCE_IPC } from '../shared/plan-balance';
import {
  readPlanBalance,
  refreshPlanBalance,
  readPlanBalanceKeyStatus,
} from './plan-balance';

export function registerPlanBalanceIpc(): () => void {
  ipcMain.removeHandler(PLAN_BALANCE_IPC.PULL);
  ipcMain.removeHandler(PLAN_BALANCE_IPC.REFRESH);
  ipcMain.removeHandler(PLAN_BALANCE_IPC.KEY_STATUS);

  ipcMain.handle(PLAN_BALANCE_IPC.PULL, () => readPlanBalance());
  ipcMain.handle(PLAN_BALANCE_IPC.REFRESH, () => refreshPlanBalance());
  ipcMain.handle(PLAN_BALANCE_IPC.KEY_STATUS, () => ({
    success: true,
    message: '',
    data: readPlanBalanceKeyStatus(),
  }));

  return () => {
    ipcMain.removeHandler(PLAN_BALANCE_IPC.PULL);
    ipcMain.removeHandler(PLAN_BALANCE_IPC.REFRESH);
    ipcMain.removeHandler(PLAN_BALANCE_IPC.KEY_STATUS);
  };
}
