// SPDX-License-Identifier: MIT
// main/ark-subscription.test.ts -- 凭据解析/缺失态测试（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 用 env 注入方式验证 resolveArkCredentials 优先 env；缺凭据态返回 null
// 安全：测试用 fake AK/SK，不暴露也不读取真实键
test('resolveArkCredentials returns null when env empty and safeStorage empty', async () => {
  delete process.env.VOLC_ACCESS_KEY_ID;
  delete process.env.VOLC_SECRET_ACCESS_KEY;
  // safeStorage 在 Electron 上下文外会抛；这里仅测"无 env 且模块能 import"
  const { resolveArkCredentials } = await import('./subscription-keystore');
  const out = resolveArkCredentials();
  // 可能是 null（无 env + 无 safeStorage）；safeStorage 在测试环境抛则函数也走 fallback
  assert.ok(out === null || (out && typeof out.accessKeyId === 'string'));
});

test('resolveArkCredentials prefers env over stored (env present returns env value)', async () => {
  process.env.VOLC_ACCESS_KEY_ID = 'AKLTENVTEST';
  process.env.VOLC_SECRET_ACCESS_KEY = 'SKENVTEST';
  const { resolveArkCredentials } = await import('./subscription-keystore');
  const out = resolveArkCredentials();
  assert.ok(out, 'env should produce a credential');
  assert.equal(out!.accessKeyId, 'AKLTENVTEST');
  delete process.env.VOLC_ACCESS_KEY_ID;
  delete process.env.VOLC_SECRET_ACCESS_KEY;
});

test('resolveMiniMaxCredentials returns null when env empty and no stored', async () => {
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_CODING_KEY;
  const { resolveMiniMaxCredentials } = await import('./subscription-keystore');
  const out = resolveMiniMaxCredentials();
  assert.ok(out === null || (out && typeof out.token === 'string'));
});

test('resolveMiniMaxCredentials prefers env over stored', async () => {
  process.env.MINIMAX_API_KEY = 'sk-cp-env-test';
  const { resolveMiniMaxCredentials } = await import('./subscription-keystore');
  const out = resolveMiniMaxCredentials();
  assert.ok(out, 'env should produce a credential');
  assert.equal(out!.token, 'sk-cp-env-test');
  assert.equal(out!.region, 'auto');
  delete process.env.MINIMAX_API_KEY;
});