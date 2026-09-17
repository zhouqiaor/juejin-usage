// SPDX-License-Identifier: MIT
// main/pc-bridge-ipc.ts
//
// 注册 PC 桥接的 IPC handler（D4 MVP）。renderer 通过以下 channel 控制桥接：
//   - pc-bridge:enable  → 启动 8453 server + 生成临时 token + 返回 { ip, port, token, url, qrDataUrl }
//   - pc-bridge:disable → 清 token + 关 server
//   - pc-bridge:status  → 返回当前桥接状态
//
// 对局域网吐出的报文冻结为 bridge v1 契约（pc-bridge-schema.ts）：
// 原始数据取自 local-runtime 的内存 Hono app（/functions/tud-usage-summary 与
// /functions/tud-usage-hourly），即与 sidecar 8452 同一份 aggregateCache 聚合结果，
// 在本层映射为 v1（今日 bySource 由当日 hourly 行按 source 聚合）。
import { ipcMain } from 'electron';

import { enableBridge, disableBridge, getBridgeInfo } from './pc-bridge-http';
import { renderPairingQrDataUrl } from './pc-bridge-qr';
import { localApiRequest } from './local-runtime';
import {
  localDateString,
  resolveTodayDate,
  toBridgeSummaryV1,
  type PcBridgeSummaryV1,
} from './pc-bridge-schema';
import type { HourlyUsageRow, UsageSummary } from '@juejin-opensource/jusage-core';

const CHANNEL_ENABLE = 'pc-bridge:enable';
const CHANNEL_DISABLE = 'pc-bridge:disable';
const CHANNEL_STATUS = 'pc-bridge:status';

interface PcBridgeEnableResult {
  ip: string;
  port: number;
  token: string;
  url: string;
  qrDataUrl: string;
}

async function localApiData<T>(path: string): Promise<T> {
  const res = await localApiRequest(path);
  const body = res.body as { success?: boolean; data?: T } | null;
  if (res.status !== 200 || !body || body.success !== true) {
    throw new Error(`local api unavailable: ${path}`);
  }
  return body.data as T;
}

/** 取数 + 映射为冻结 v1 载荷；hourly 缺失时降级为只给今日 totals。 */
async function buildV1Summary(): Promise<PcBridgeSummaryV1> {
  const core = await localApiData<UsageSummary>('/functions/tud-usage-summary');
  let hours: HourlyUsageRow[] = [];
  try {
    const hourly = await localApiData<{ hours?: HourlyUsageRow[] }>(
      '/functions/tud-usage-hourly?days=1',
    );
    hours = Array.isArray(hourly.hours) ? hourly.hours : [];
  } catch {
    hours = [];
  }
  const todayDate = resolveTodayDate(hours, localDateString());
  return toBridgeSummaryV1({ core, hours, todayDate });
}

export function registerPcBridgeIpc(): void {
  ipcMain.removeHandler(CHANNEL_ENABLE);
  ipcMain.handle(CHANNEL_ENABLE, async (): Promise<PcBridgeEnableResult> => {
    const info = await enableBridge({ getUsageSummary: buildV1Summary });
    const qrDataUrl = info.url ? await renderPairingQrDataUrl(info.url) : '';
    return {
      ip: info.ip,
      port: info.port,
      token: info.token ?? '',
      url: info.url ?? '',
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
