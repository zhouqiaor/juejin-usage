// SPDX-License-Identifier: MIT
// main/pc-bridge-qr.ts
//
// 把配对 URL 渲染成 QR data URL，供托盘菜单 / 设置页展示，PlanPulse 相机扫码后直连。
//
// 环境中无 @types/qrcode：结构类型声明见同级 qrcode.d.ts。
/** 将配对 URL 渲染为可在 <img> 中展示的 QR data URL。 */
export async function renderPairingQrDataUrl(pairingUrl: string): Promise<string> {
  try {
    const QRCode = (await import('qrcode')).default;
    return await QRCode.toDataURL(pairingUrl, { margin: 1, width: 320 });
  } catch {
    // 退化：无 qrcode 依赖时返回可读文本（仅骨架/联调用，PlanPulse 不可扫）。
    return `data:text/plain;charset=utf-8,${encodeURIComponent(pairingUrl)}`;
  }
}
