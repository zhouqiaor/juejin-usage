// SPDX-License-Identifier: MIT
// main/pc-bridge-http.test.ts -- D4 PC 桥接 HTTP server 单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  enableBridge,
  disableBridge,
  getBridgeInfo,
  PC_BRIDGE_DEFAULT_PORT,
  type UsageSummary,
} from './pc-bridge-http.js';

// 固定样本，验证正确 token 时原样返回。
const SAMPLE: UsageSummary = {
  asOf: new Date().toISOString(),
  version: 6,
  today: {
    date: '2026-09-17',
    totalTokens: 1234,
    totalCostUsd: 0.5,
    bySource: { workbuddy: { tokens: 1234, costUsd: 0.5, models: [] } },
    topProjects: [],
  },
};

function makeDeps() {
  return { getUsageSummary: async (): Promise<UsageSummary> => SAMPLE };
}

async function fetchSummary(
  tokenValue: string | null,
): Promise<{ status: number; body: string }> {
  const qs = tokenValue ? `?token=${tokenValue}` : '';
  const res = await fetch(
    `http://127.0.0.1:${PC_BRIDGE_DEFAULT_PORT}/api/usage/summary${qs}`,
  );
  const text = await res.text();
  return { status: res.status, body: text };
}

// 注意：node:test 在单文件内默认顺序执行，server 生命周期贯穿 test1→test5。
test('enableBridge() 后 server 监听 8453', async () => {
  const info = await enableBridge(makeDeps());
  assert.equal(info.enabled, true);
  assert.equal(info.port, PC_BRIDGE_DEFAULT_PORT);
  assert.equal(typeof info.token, 'string');
  assert.equal(info.token!.length, 32); // 16 字节 hex
  // 真实在监听：未带 token 应 401
  const probe = await fetchSummary(null);
  assert.equal(probe.status, 401);
});

test('无 token 访问 → 401', async () => {
  const res = await fetchSummary(null);
  assert.equal(res.status, 401);
});

test('错 token 访问 → 401', async () => {
  const res = await fetchSummary('deadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(res.status, 401);
});

test('正确 token 访问 → 200 + summary JSON', async () => {
  const token = getBridgeInfo().token;
  assert.ok(token, 'bridge 应已 enable 且持有 token');
  const res = await fetchSummary(token!);
  assert.equal(res.status, 200);
  const parsed = JSON.parse(res.body) as UsageSummary;
  assert.deepEqual(parsed, SAMPLE);
});

test('disableBridge() 后 server 关闭', async () => {
  await disableBridge();
  assert.equal(getBridgeInfo().enabled, false);
  assert.equal(getBridgeInfo().token, null);
  // 端口已关闭：连接应被拒绝
  await assert.rejects(() => fetchSummary('whatever'));
});
