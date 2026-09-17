// SPDX-License-Identifier: MIT
// main/pc-bridge-qr.ts
//
// 把配对 URL 渲染成 QR data URL，供托盘菜单 / 设置页展示，PlanPulse 相机扫码后直连。
//
// 生产环境依赖 `qrcode`（已在 apps/desktop/package.json 声明）。为让本骨架在
// 未安装该依赖的沙箱中也能 typecheck / 跑通，这里用动态 import + 退化分支：
// 取不到库时回落为纯文本 data URL（仅用于联调，不可被 PlanPulse 扫描）。
declare module 'qrcode' {
  const QRCode: {
    toDataURL: (
      text: string,
      opts?: { margin?: number; width?: number },
    ) => Promise<string>;
  };
  export default QRCode;
}

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
