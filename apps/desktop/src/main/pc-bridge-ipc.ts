// SPDX-License-Identifier: MIT
// main/pc-bridge-ipc.ts
//
// 注册 PC 桥接的 IPC handler（D4）。renderer 通过以下 channel 控制桥接：
//   - pc-bridge:enable  ({lan}) → 启动 8453 HTTPS server + 生成临时 token +
//                                  回传 { ip, port, token, url, qrDataUrl, qrError, spki256, ... }
//   - pc-bridge:disable → 清 token + 关 server
//   - pc-bridge:status  → 返回当前桥接状态
//   - pc-bridge:reset-identity → 删除落盘自签身份并按当前模式重启（旧手机配对立即 FAIL_PIN）
//
// 对局域网吐出的报文冻结为 bridge v1 契约（pc-bridge-schema.ts）：
// 原始数据取自 local-runtime 的内存 Hono app（/functions/tud-usage-summary 与
// /functions/tud-usage-hourly），即与 sidecar 8452 同一份 aggregateCache 聚合结果，
// 在本层映射为 v1（今日 bySource 由当日 hourly 行按 source 聚合）。
import { app, ipcMain } from 'electron';
import { join } from 'node:path';

import { enableBridge, disableBridge, getBridgeInfo, getLocalIp } from './pc-bridge-http';
import { QrRenderError, renderPairingQrDataUrl } from './pc-bridge-qr';
import { ensureBridgeIdentity, resetBridgeIdentity } from './pc-bridge-tls';
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
const CHANNEL_RESET_IDENTITY = 'pc-bridge:reset-identity';

interface PcBridgeEnableResult {
  ip: string;
  host: string;
  port: number;
  token: string;
  url: string;
  tls: boolean;
  lan: boolean;
  spki256: string | null;
  /** 成功时为 data:image/png；失败为空串（见 qrError）。 */
  qrDataUrl: string;
  /** QR 组件缺失/渲染失败时的机器可读错误码（QR_LIB_MISSING），正常为 null。 */
  qrError: string | null;
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

/** 自签身份落盘目录（userData 内；key.pem 0600）。 */
function identityDir(): string {
  return join(app.getPath('userData'), 'pc-bridge-identity');
}

async function enable(lan: boolean): Promise<PcBridgeEnableResult> {
  const lanIps = lan ? [getLocalIp()] : [];
  const id = ensureBridgeIdentity(identityDir(), lanIps);
  const info = await enableBridge(
    { getUsageSummary: buildV1Summary },
    { lan, identity: id },
  );
  let qrDataUrl = '';
  let qrError: string | null = null;
  if (info.url) {
    try {
      qrDataUrl = await renderPairingQrDataUrl(info.url);
    } catch (err) {
      // S10：显式错误态，绝不把 text/plain 占位当二维码展示
      qrError = err instanceof QrRenderError ? err.code : 'QR_LIB_MISSING';
    }
  }
  return {
    ip: info.ip,
    host: info.host,
    port: info.port,
    token: info.token ?? '',
    url: info.url ?? '',
    tls: info.tls,
    lan: info.lan,
    spki256: info.spki256,
    qrDataUrl,
    qrError,
  };
}

export function registerPcBridgeIpc(): void {
  ipcMain.removeHandler(CHANNEL_ENABLE);
  ipcMain.handle(
    CHANNEL_ENABLE,
    async (_event, options?: { lan?: boolean }): Promise<PcBridgeEnableResult> =>
      enable(options?.lan === true),
  );

  ipcMain.removeHandler(CHANNEL_DISABLE);
  ipcMain.handle(CHANNEL_DISABLE, async () => {
    await disableBridge();
    return getBridgeInfo();
  });

  ipcMain.removeHandler(CHANNEL_STATUS);
  ipcMain.handle(CHANNEL_STATUS, () => getBridgeInfo());

  ipcMain.removeHandler(CHANNEL_RESET_IDENTITY);
  ipcMain.handle(CHANNEL_RESET_IDENTITY, async () => {
    // 删除落盘身份；若 server 在跑，按当前模式重启并重新出 QR（旧指纹配对立即失效）
    resetBridgeIdentity(identityDir());
    const current = getBridgeInfo();
    if (current.enabled) {
      await disableBridge();
      return enable(current.lan);
    }
    return null;
  });
}
