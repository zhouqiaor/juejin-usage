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
import { V1_FIXTURE } from './pc-bridge-schema.js';

// 冻结 v1 契约的固定样本（与 Android PcUsageFetcherTest 的成功报文为同一字面量）。
const SAMPLE: UsageSummary = V1_FIXTURE;

function makeDeps() {
  return { getUsageSummary: async (): Promise<UsageSummary> => SAMPLE };
}

async function fetchSummary(
  tokenValue: string | null,
  path = '/api/usage/summary',
): Promise<{ status: number; body: string; contentType: string }> {
  const qs = tokenValue ? `?token=${tokenValue}` : '';
  const res = await fetch(`http://127.0.0.1:${PC_BRIDGE_DEFAULT_PORT}${path}${qs}`);
  const text = await res.text();
  return {
    status: res.status,
    body: text,
    contentType: res.headers.get('content-type') ?? '',
  };
}

// 注意：node:test 在单文件内默认顺序执行，server 生命周期贯穿 test1→test6。
test('enableBridge() 后 server 监听 8453 且持有 128-bit token', async () => {
  const info = await enableBridge(makeDeps());
  assert.equal(info.enabled, true);
  assert.equal(info.port, PC_BRIDGE_DEFAULT_PORT);
  assert.equal(typeof info.token, 'string');
  assert.equal(info.token!.length, 32); // 16 字节 hex
  // 真实在监听：未带 token 应 401
  const probe = await fetchSummary(null);
  assert.equal(probe.status, 401);
});

test('无 token 访问 → 401 + JSON 错误体', async () => {
  const res = await fetchSummary(null);
  assert.equal(res.status, 401);
  assert.match(res.contentType, /^application\/json/);
  const parsed = JSON.parse(res.body) as { error?: { code?: string } };
  assert.equal(parsed.error?.code, 'UNAUTHORIZED');
});

test('错 token 访问 → 401', async () => {
  const res = await fetchSummary('deadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.body).error.code, 'UNAUTHORIZED');
});

test('未知路径 / 非 GET → 404 + JSON 错误体', async () => {
  const res = await fetchSummary(getBridgeInfo().token, '/api/usage/nope');
  assert.equal(res.status, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});

test('正确 token 访问 → 200 + v1 契约形状', async () => {
  const token = getBridgeInfo().token;
  assert.ok(token, 'bridge 应已 enable 且持有 token');
  const res = await fetchSummary(token);
  assert.equal(res.status, 200);
  assert.match(res.contentType, /^application\/json/);
  const parsed = JSON.parse(res.body) as UsageSummary & Record<string, unknown>;
  assert.deepEqual(parsed, SAMPLE);
  // 契约关键字段逐项固化（防 mapper 回归）
  assert.equal(parsed.version, 1);
  assert.ok(typeof parsed.asOf === 'string' && parsed.asOf.includes('T'));
  assert.equal(parsed.today.date, '2026-09-17');
  assert.equal(parsed.today.totalTokens, 1234);
  assert.equal(parsed.today.totalCostUsd, 0.12);
  assert.deepEqual(parsed.today.bySource.codex, { tokens: 1000, costUsd: 0.1 });
  assert.deepEqual(parsed.today.topProjects, []);
  assert.equal('window5h' in parsed, false);
});

test('disableBridge() 后 server 关闭', async () => {
  await disableBridge();
  assert.equal(getBridgeInfo().enabled, false);
  assert.equal(getBridgeInfo().token, null);
  // 端口已关闭：连接应被拒绝
  await assert.rejects(() => fetchSummary('whatever'));
});
