// SPDX-License-Identifier: MIT
// main/pc-bridge-qr.test.ts -- S10：QR 渲染成功路径与缺库显式失败（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  QrRenderError,
  renderPairingQrDataUrl,
  renderPairingQrDataUrlWith,
} from './pc-bridge-qr.js';

const SAMPLE_URL =
  'https://192.168.1.10:8453/api/usage/summary?token=abcdef0123456789abcdef0123456789#spki256=' +
  'a'.repeat(64);

test('真实 qrcode 依赖：渲染为 PNG data URL 且内容非空', async () => {
  const url = await renderPairingQrDataUrl(SAMPLE_URL);
  assert.match(url, /^data:image\/png;base64,/);
  assert.ok(url.length > 1000);
});

test('S10：loader 缺库 → 抛 QrRenderError(QR_LIB_MISSING)，绝不回退 text/plain', async () => {
  const failing = async () => {
    throw new Error("Cannot find package 'qrcode'");
  };
  await assert.rejects(() => renderPairingQrDataUrlWith(failing, SAMPLE_URL), (err: unknown) => {
    assert.ok(err instanceof QrRenderError);
    assert.equal((err as QrRenderError).code, 'QR_LIB_MISSING');
    assert.match((err as Error).message, /二维码组件缺失/);
    return true;
  });
});

test('S10：toDataURL 渲染异常同样抛 QrRenderError（不静默降级）', async () => {
  const broken = async () => ({
    default: {
      toDataURL: () => {
        throw new Error('render boom');
      },
    },
  });
  await assert.rejects(() => renderPairingQrDataUrlWith(broken, SAMPLE_URL), (err: unknown) => {
    assert.ok(err instanceof QrRenderError);
    assert.equal((err as QrRenderError).code, 'QR_LIB_MISSING');
    assert.match((err as Error).message, /二维码渲染失败/);
    return true;
  });
});

test('成功路径（注入 loader）：返回底层 data URL', async () => {
  const loader = async () => ({
    toDataURL: async (text: string) => `data:image/png;base64,ENCODED(${text.length})`,
  });
  const out = await renderPairingQrDataUrlWith(loader, SAMPLE_URL);
  assert.match(out, /^data:image\/png;base64,ENCODED\(\d+\)$/);
});
