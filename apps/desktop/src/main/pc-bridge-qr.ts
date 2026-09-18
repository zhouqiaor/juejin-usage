// SPDX-License-Identifier: MIT
// main/pc-bridge-qr.ts
//
// 把配对 URL 渲染成 QR data URL，供托盘菜单 / 设置页展示，PlanPulse 相机扫码后直连。
//
// S10 硬化（2026-09-18）：qrcode 依赖缺失/渲染失败时不再静默降级成 data:text/plain
// （那会让面板把不可扫的文本占位当二维码展示，用户无感知）。改为抛出 [QrRenderError]，
// 由 IPC/面板渲染显式错误态「二维码组件缺失，请复制配对 URL 手动录入」并记录主进程日志。

/** QR 渲染失败（缺库/渲染异常）；code 固定供 IPC/UI 分类。 */
export class QrRenderError extends Error {
  readonly code = 'QR_LIB_MISSING';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'QrRenderError';
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

type QrLib = {
  toDataURL(text: string, options?: { margin?: number; width?: number }): Promise<string> | string;
};
type QrLoader = () => Promise<{ default: QrLib } | QrLib>;

/** 默认加载器：动态 import 可选依赖 qrcode（结构类型声明见同级 qrcode.d.ts）。 */
const defaultLoader: QrLoader = () => import('qrcode') as Promise<{ default: QrLib }>;

/**
 * 渲染 QR data URL；失败统一抛 [QrRenderError]（绝不静默返回不可扫的纯文本）。
 * loader 可注入用于测试缺库/渲染异常路径。
 */
export async function renderPairingQrDataUrlWith(
  loader: QrLoader,
  pairingUrl: string,
): Promise<string> {
  let lib: QrLib;
  try {
    const mod = await loader();
    lib = 'default' in mod ? mod.default : mod;
  } catch (err) {
    console.error('[pc-bridge] qrcode 组件缺失，无法生成二维码：', err);
    throw new QrRenderError('二维码组件缺失（qrcode 不可用），请复制配对 URL 手动录入', {
      cause: err,
    });
  }
  try {
    return await lib.toDataURL(pairingUrl, { margin: 1, width: 320 });
  } catch (err) {
    console.error('[pc-bridge] 二维码渲染失败：', err);
    throw new QrRenderError('二维码渲染失败，请复制配对 URL 手动录入', { cause: err });
  }
}

/** 将配对 URL 渲染为可在 <img> 中展示的 QR data URL；失败抛 [QrRenderError]。 */
export function renderPairingQrDataUrl(pairingUrl: string): Promise<string> {
  return renderPairingQrDataUrlWith(defaultLoader, pairingUrl);
}
