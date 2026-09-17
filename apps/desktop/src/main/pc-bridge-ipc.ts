// SPDX-License-Identifier: MIT
// main/pc-bridge-ipc.ts
//
// 注册 PC 桥接的 IPC handler（D4 第一阶段）。renderer 通过以下 channel 控制桥接：
//   - pc-bridge:enable  → 启动 8453 server + 生成临时 token + 返回 { ip, port, token, qrDataUrl }
//   - pc-bridge:disable → 清 token + 关 server
//   - pc-bridge:status  → 返回当前桥接状态
//
// 用量摘要取自 local-runtime 的内存 Hono app（/functions/tud-usage-summary），
// 即与 sidecar 8452 同一份 aggregateCache 聚合结果。
import { ipcMain } from 'electron';

import { enableBridge, disableBridge, getBridgeInfo } from './pc-bridge-http';
import { renderPairingQrDataUrl } from './pc-bridge-qr';
import { localApiRequest } from './local-runtime';

const CHANNEL_ENABLE = 'pc-bridge:enable';
const CHANNEL_DISABLE = 'pc-bridge:disable';
const CHANNEL_STATUS = 'pc-bridge:status';

interface PcBridgeEnableResult {
  ip: string;
  port: number;
  token: string;
  qrDataUrl: string;
}

async function fetchUsageSummary(): Promise<unknown> {
  const res = await localApiRequest('/functions/tud-usage-summary');
  const body = res.body as { success?: boolean; data?: unknown } | null;
  if (res.status !== 200 || !body || body.success !== true) {
    throw new Error('usage summary unavailable');
  }
  return body.data;
}

export function registerPcBridgeIpc(): void {
  ipcMain.removeHandler(CHANNEL_ENABLE);
  ipcMain.handle(CHANNEL_ENABLE, async (): Promise<PcBridgeEnableResult> => {
    const info = await enableBridge({ getUsageSummary: fetchUsageSummary });
    const qrDataUrl = info.url ? await renderPairingQrDataUrl(info.url) : '';
    return {
      ip: info.ip,
      port: info.port,
      token: info.token ?? '',
      qrDataUrl,
    };
  });

  ipcMain.removeHandler(CHANNEL_DISABLE);
  ipcMain.handle(CHANNEL_DISABLE, async () => {
    await disableBridge();
    return getBridgeInfo();
  });

  ipcMain.removeHandler(CHANNEL_STATUS);
  ipcMain.handle(CHANNEL_STATUS, () => getBridgeInfo());
}
