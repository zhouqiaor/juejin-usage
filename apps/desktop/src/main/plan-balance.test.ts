// SPDX-License-Identifier: MIT
// main/plan-balance.test.ts — Coding Plan 余量 IPC 单测
//
// 模式：仿 qoder-subscription.test.ts（node:test + node:assert/strict）
// 范围：仅测纯函数 + 缓存状态；spawn 路径靠 E2E 覆盖（避免沙箱内真起 python）
//
// 覆盖：
//   - safeMessage: 脱敏 + 截断 + 中文标点
//   - readPlanBalanceKeyStatus: 读 env（含空白=未配置）
//   - _peekForTest/_resetForTest: 缓存状态
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readPlanBalanceKeyStatus,
  _resetForTest,
  _peekForTest,
  safeMessage,
} from './plan-balance';

// -----------------------------------------------------------------------
// safeMessage 脱敏
// -----------------------------------------------------------------------
test('safeMessage redacts MiniMax sk-cp- keys', () => {
  const out = safeMessage('error: sk-cp-35bTBVLZh1234567890abcdef is invalid');
  assert.equal(out.includes('sk-cp-'), false, 'MiniMax key 应被脱敏');
  assert.equal(out.includes('[REDACTED]'), true);
});

test('safeMessage redacts 火山方舟 AKLT keys', () => {
  const out = safeMessage('failed: AKLT1234567890ABCDEFGHIJK');
  assert.equal(out.includes('AKLT'), false);
  assert.equal(out.includes('[REDACTED]'), true);
});

test('safeMessage passes through ordinary errors', () => {
  const out = safeMessage('网络超时 5s，请稍后重试');
  assert.equal(out, '网络超时 5s，请稍后重试');
});

test('safeMessage truncates > 400 chars', () => {
  const long = 'x'.repeat(500);
  const out = safeMessage(long);
  assert.ok(out.length <= 410, `应截断到 ≤410，实际 ${out.length}`);
  assert.ok(out.endsWith('…'));
});

// -----------------------------------------------------------------------
// 凭证状态
// -----------------------------------------------------------------------
test('readPlanBalanceKeyStatus reflects env presence', () => {
  _resetForTest();
  const saved = { ...process.env };
  try {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_CODING_KEY;
    delete process.env.VOLC_ACCESS_KEY_ID;
    delete process.env.VOLC_SECRET_ACCESS_KEY;
    const r0 = readPlanBalanceKeyStatus();
    assert.equal(r0.length, 2);
    assert.equal(r0.find((s) => s.plan === 'minimax')?.configured, false);
    assert.equal(r0.find((s) => s.plan === 'ark')?.configured, false);

    process.env.MINIMAX_API_KEY = 'sk-cp-test0000000000000000';
    const r1 = readPlanBalanceKeyStatus();
    assert.equal(r1.find((s) => s.plan === 'minimax')?.configured, true);
    assert.equal(r1.find((s) => s.plan === 'ark')?.configured, false);

    process.env.VOLC_ACCESS_KEY_ID = 'ak';
    process.env.VOLC_SECRET_ACCESS_KEY = 'sk';
    const r2 = readPlanBalanceKeyStatus();
    assert.equal(r2.find((s) => s.plan === 'ark')?.configured, true);
  } finally {
    process.env = saved;
  }
});

// -----------------------------------------------------------------------
// 缓存 + in-flight 状态
// -----------------------------------------------------------------------
test('_resetForTest clears all cache', () => {
  readPlanBalanceKeyStatus();
  _resetForTest();
  const s = _peekForTest();
  assert.equal(s.lastSuccessTs, null);
  assert.equal(s.lastFailureTs, null);
  assert.equal(s.inFlight, false);
});

// -----------------------------------------------------------------------
// 错误降级与脱敏加固
// -----------------------------------------------------------------------
test('safeMessage handles multi-line stack traces', () => {
  const stack = `Error: spawn failed
    at ChildProcess.exithandler (node:child_process:420:12)
    at maybeClose (node:internal/process:1064:16)
    sk-cp-THISISFAKEKEY1234567890ABCDEFG`;
  const out = safeMessage(stack);
  assert.equal(out.includes('sk-cp-THISISFAKE'), false);
  assert.equal(out.includes('[REDACTED]'), true);
});

test('safeMessage preserves Chinese punctuation', () => {
  const out = safeMessage('鉴权失败（未登录/Key 无效）: AuthError');
  assert.equal(out, '鉴权失败（未登录/Key 无效）: AuthError');
});

test('readPlanBalanceKeyStatus: empty string env = not configured', () => {
  const saved = { ...process.env };
  try {
    process.env.MINIMAX_API_KEY = '   '; // 仅空白
    process.env.VOLC_ACCESS_KEY_ID = '';
    const r = readPlanBalanceKeyStatus();
    assert.equal(
      r.find((s) => s.plan === 'minimax')?.configured,
      false,
      '空白字符串视为未配置',
    );
    assert.equal(
      r.find((s) => s.plan === 'ark')?.configured,
      false,
      '空字符串视为未配置',
    );
  } finally {
    process.env = saved;
  }
});

test('_peekForTest returns valid shape', () => {
  _resetForTest();
  const s = _peekForTest();
  assert.equal(typeof s.lastSuccessTs === 'number' || s.lastSuccessTs === null, true);
  assert.equal(typeof s.lastFailureTs === 'number' || s.lastFailureTs === null, true);
  assert.equal(typeof s.inFlight, 'boolean');
});

// Key 状态契约：plan/source/configured 字段齐全（cc-switch credentialStatus 对齐）
test('readPlanBalanceKeyStatus returns stable plan+source contract', () => {
  const r = readPlanBalanceKeyStatus();
  const minimax = r.find((s) => s.plan === 'minimax');
  const ark = r.find((s) => s.plan === 'ark');
  assert.ok(minimax && ark);
  assert.equal(minimax!.source, 'minimax_coding_plan');
  assert.equal(ark!.source, 'volcengine_ark');
  assert.equal(typeof minimax!.configured, 'boolean');
  assert.equal(typeof ark!.configured, 'boolean');
});
