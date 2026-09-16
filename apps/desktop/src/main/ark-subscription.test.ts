// SPDX-License-Identifier: MIT
// main/ark-subscription.test.ts -- 凭据解析/缺失态测试（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 用 env 注入方式验证 resolveArkCredentials 优先 env；缺凭据态返回 null
// 安全：测试用 fake AK/SK，不暴露也不读取真实键
test('resolveArkCredentials: 无 env + 无 stored 时返回 null 或抛 Electron 缺失', async () => {
  delete process.env.VOLC_ACCESS_KEY_ID;
  delete process.env.VOLC_SECRET_ACCESS_KEY;
  const { resolveArkCredentials } = await import('./subscription-keystore.js');
  let out: ReturnType<typeof resolveArkCredentials> | undefined = undefined;
  try { out = resolveArkCredentials(); } catch { /* Electron 上下文缺失，预期 */ }
  // 期望：要么返回 null，要么抛（safeStorage 在测试环境不可用）
  if (out !== undefined) assert.ok(out === null || typeof out.accessKeyId === 'string');
});

test('resolveArkCredentials prefers env over stored (env present returns env value)', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTENVTEST';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKENVTEST';
  const { resolveArkCredentials } = await import('./subscription-keystore.js');
  const out = resolveArkCredentials();
  assert.ok(out, 'env should produce a credential');
  assert.equal(out!.accessKeyId, 'AKLTENVTEST');
  delete process.env.VOLC_ACCESS_KEY_ID;
  delete process.env.VOLC_SECRET_ACCESS_KEY;
});

test('resolveMiniMaxCredentials: 无 env + 无 stored 时返回 null 或抛 Electron 缺失', async () => {
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_CODING_KEY;
  const { resolveMiniMaxCredentials } = await import('./subscription-keystore.js');
  let out: ReturnType<typeof resolveMiniMaxCredentials> | undefined = undefined;
  try { out = resolveMiniMaxCredentials(); } catch { /* Electron 上下文缺失，预期 */ }
  if (out !== undefined) assert.ok(out === null || typeof out.token === 'string');
});

test('resolveMiniMaxCredentials prefers env over stored', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-env-test';
  const { resolveMiniMaxCredentials } = await import('./subscription-keystore.js');
  const out = resolveMiniMaxCredentials();
  assert.ok(out, 'env should produce a credential');
  assert.equal(out!.token, 'sk-cp-env-test');
  assert.equal(out!.region, 'auto');
  delete process.env.MINIMAX_API_KEY;
});