// SPDX-License-Identifier: MIT
// shared/ark-credentials.test.ts — Ark AccessKey ID 保存通道校验（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARK_ACCESS_KEY_PREFIX,
  validateArkAccessKeyIdForSave,
} from './ark-credentials';

test('空串（未提交）放行，返回 null', () => {
  assert.equal(validateArkAccessKeyIdForSave(''), null);
  assert.equal(validateArkAccessKeyIdForSave('   '), null);
});

test('AKLT 开头的字母数字串放行（与 Android CredStore.validArkAk 同口径）', () => {
  assert.equal(validateArkAccessKeyIdForSave('AKLTYWJjZGVmMTIzNDU2'), null);
  assert.equal(validateArkAccessKeyIdForSave('  AKLTabc123  '), null);
  assert.equal(ARK_ACCESS_KEY_PREFIX, 'AKLT');
});

test('ark- 开头的推理 API Key 被拦截，错误文案点明 IAM 口径', () => {
  const msg = validateArkAccessKeyIdForSave('ark-1234567890abcdef');
  assert.ok(msg);
  assert.match(msg as string, /AKLT/);
  assert.match(msg as string, /访问控制/);
});

test('其他非 AKLT 前缀一律拦截', () => {
  for (const bad of ['sk-xxx', 'foo', '12345', 'AKLT', 'akltYWJj', 'AKLT-abc']) {
    assert.ok(validateArkAccessKeyIdForSave(bad), `应当拒绝: ${bad}`);
  }
});

test('AKLT 前缀但含非法字符（复制不完整/空格）给出形态错误', () => {
  const msg = validateArkAccessKeyIdForSave('AKLTabc def');
  assert.ok(msg);
  assert.match(msg as string, /形态不正确/);
});
