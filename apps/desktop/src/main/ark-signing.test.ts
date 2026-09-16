// SPDX-License-Identifier: MIT
// main/ark-signing.test.ts -- 固定 x-date 验证签名输出（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arkCanonicalQuery, signArk } from './ark-signing';

test('canonicalQuery is Action/Region/Version sorted lexicographically', () => {
  // Action < Region < Version alphabetically, so output order is Action/Region/Version
  assert.equal(arkCanonicalQuery('GetAFPUsage', 'cn-beijing'), 'Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01');
});

test('signArk produces stable Authorization for fixed input', () => {
  const fixedDate = new Date('2026-09-16T00:00:00.000Z');
  const sig = signArk('AKLTFAKEAK', 'SECRETSKFAKE', 'cn-beijing', 'GetAFPUsage', Buffer.alloc(0), fixedDate);
  // x-date must be the UTC format without separators
  assert.equal(sig.xDate, '20260916T000000Z');
  // x-content-sha256 of empty buffer
  assert.equal(sig.xContentSha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  // Authorization header starts with HMAC-SHA256 Credential=AK/Scope
  assert.match(sig.authorization, /^HMAC-SHA256 Credential=AKLTFAKEAK\/\d{8}\/cn-beijing\/ark\/request, SignedHeaders=host;x-date;x-content-sha256;content-type, Signature=[0-9a-f]{64}$/);
});

test('signArk signature changes with different now', () => {
  const d1 = new Date('2026-09-16T00:00:00.000Z');
  const d2 = new Date('2026-09-16T00:00:01.000Z');
  const s1 = signArk('AK', 'SK', 'cn-beijing', 'GetAFPUsage', Buffer.alloc(0), d1);
  const s2 = signArk('AK', 'SK', 'cn-beijing', 'GetAFPUsage', Buffer.alloc(0), d2);
  assert.notEqual(s1.xDate, s2.xDate);
  assert.notEqual(s1.authorization, s2.authorization);
});

test('signArk signature is deterministic for identical inputs', () => {
  const d = new Date('2026-09-16T12:34:56.789Z');
  const a = signArk('AK', 'SK', 'cn-shanghai', 'GetCodingPlanUsage', Buffer.alloc(0), d);
  const b = signArk('AK', 'SK', 'cn-shanghai', 'GetCodingPlanUsage', Buffer.alloc(0), d);
  assert.equal(a.authorization, b.authorization);
});