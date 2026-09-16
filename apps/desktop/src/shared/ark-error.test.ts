// SPDX-License-Identifier: MIT
// shared/ark-error.test.ts — 火山错误码中文友好化（node:test，对齐 Android QuotaCodec.friendly）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyArkError } from './ark-error';

test('SignatureDoesNotMatch → 签名不匹配中文提示并保留原始错误码', () => {
  const out = friendlyArkError('SignatureDoesNotMatch: bad secret');
  assert.match(out, /签名不匹配/);
  assert.match(out, /SecretAccessKey/);
  assert.ok(out.includes('SignatureDoesNotMatch'));
});

test('InvalidAccessKey / InvalidAuthorization → 提示 IAM AK/SK 口径', () => {
  assert.match(friendlyArkError('InvalidAccessKeyId'), /AK 无效/);
  assert.match(friendlyArkError('InvalidAuthorization'), /AK 无效/);
  assert.match(friendlyArkError('InvalidAccessKeyId'), /访问控制（IAM）/);
});

test('InvalidTimestamp / RequestExpired → 系统时间提示', () => {
  assert.match(friendlyArkError('InvalidTimestamp'), /时间戳失效/);
  assert.match(friendlyArkError('RequestExpired'), /时间戳失效/);
  assert.match(friendlyArkError('RequestExpired'), /系统时间/);
});

test('未知错误原样返回；空串安全', () => {
  assert.equal(friendlyArkError('SomeOtherError: boom'), 'SomeOtherError: boom');
  assert.equal(friendlyArkError(''), '');
});
