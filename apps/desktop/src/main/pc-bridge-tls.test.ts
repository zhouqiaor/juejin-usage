// SPDX-License-Identifier: MIT
// main/pc-bridge-tls.test.ts -- 自签身份 / SPKI 指纹 / 文件身份库（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createPublicKey, X509Certificate } from 'node:crypto';

import {
  certIpSans,
  ensureBridgeIdentity,
  generateBridgeIdentity,
  resetBridgeIdentity,
  spkiSha256FromPem,
} from './pc-bridge-tls.js';

function independentPin(certPem: string): string {
  const spki = createPublicKey(certPem).export({ type: 'spki', format: 'der' }) as Buffer;
  return createHash('sha256').update(spki).digest('hex');
}

test('generateBridgeIdentity: PEM 可解析为自签 v3 证书，CN=PC Bridge', () => {
  const id = generateBridgeIdentity([]);
  assert.match(id.key, /^-----BEGIN PRIVATE KEY-----/);
  assert.match(id.cert, /^-----BEGIN CERTIFICATE-----/);
  const x509 = new X509Certificate(id.cert);
  assert.ok(x509.subject.includes('CN=PC Bridge'));
  assert.ok(x509.issuer.includes('CN=PC Bridge'));
  assert.equal(x509.checkIssued(x509), true); // 自签
  assert.equal(x509.ca, false); // basicConstraints cA=false
});

test('SAN 默认含 DNS localhost 与 IP 127.0.0.1，传入的 LAN IPv4 也写入', () => {
  const id = generateBridgeIdentity(['192.168.64.10', '10.20.30.40']);
  const x509 = new X509Certificate(id.cert);
  assert.ok((x509.subjectAltName ?? '').includes('DNS:localhost'));
  const ips = certIpSans(id.cert);
  assert.deepEqual([...ips].sort(), ['10.20.30.40', '127.0.0.1', '192.168.64.10']);
});

test('损坏/非法 IPv4 不入 SAN；重复值去重', () => {
  const id = generateBridgeIdentity(['not-an-ip', '192.168.1.1', '192.168.1.1', '999.1.1.1']);
  const ips = certIpSans(id.cert);
  assert.deepEqual([...ips].sort(), ['127.0.0.1', '192.168.1.1']);
});

test('pin 为 SPKI SHA-256 小写 64 hex，与独立计算一致（对齐 Android spkiSha256Hex）', () => {
  const id = generateBridgeIdentity(['10.0.0.7']);
  assert.match(id.pin, /^[0-9a-f]{64}$/);
  assert.equal(id.pin, spkiSha256FromPem(id.cert));
  assert.equal(id.pin, independentPin(id.cert));
});

test('两份身份密钥不同 → 指纹不同；同一证书指纹稳定', () => {
  const a = generateBridgeIdentity([]);
  const b = generateBridgeIdentity([]);
  assert.notEqual(a.pin, b.pin);
  assert.equal(spkiSha256FromPem(a.cert), a.pin);
});

test('证书有效期约 10 年', () => {
  const id = generateBridgeIdentity([]);
  const x509 = new X509Certificate(id.cert);
  const days = (x509.validToDate.getTime() - x509.validFromDate.getTime()) / 86_400_000;
  assert.ok(days >= 3640 && days <= 3652, `days=${days}`);
});

test('ensureBridgeIdentity: 首次落盘并复用（同 SAN 不轮换）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pc-bridge-id-'));
  const first = ensureBridgeIdentity(dir, []);
  assert.ok(existsSync(join(dir, 'pc-bridge-key.pem')));
  assert.ok(existsSync(join(dir, 'pc-bridge-cert.pem')));
  const second = ensureBridgeIdentity(dir, []);
  assert.equal(second.pin, first.pin);
  assert.equal(second.cert, first.cert);
  // 落盘 PEM 可读且一致
  assert.equal(readFileSync(join(dir, 'pc-bridge-cert.pem'), 'utf8').length > 0, true);
});

test('ensureBridgeIdentity: 所需 LAN IP 变化 → 自动重签，新 SAN/新指纹', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pc-bridge-id-'));
  const loop = ensureBridgeIdentity(dir, []);
  assert.deepEqual(certIpSans(loop.cert), ['127.0.0.1']);
  const lan = ensureBridgeIdentity(dir, ['192.168.5.55']);
  assert.notEqual(lan.pin, loop.pin);
  assert.deepEqual(certIpSans(lan.cert), ['127.0.0.1', '192.168.5.55']);
  // 再读一次复用新身份
  assert.equal(ensureBridgeIdentity(dir, ['192.168.5.55']).pin, lan.pin);
});

test('ensureBridgeIdentity: key 文件损坏 → 重新签发而非抛错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pc-bridge-id-'));
  ensureBridgeIdentity(dir, []);
  const keyPath = join(dir, 'pc-bridge-key.pem');
  chmodSync(keyPath, 0o600);
  // Windows 下 chmod 有限，主要验证内容损坏路径
  writeFileSync(keyPath, 'not a pem');
  const repaired = ensureBridgeIdentity(dir, []);
  assert.match(repaired.key, /^-----BEGIN PRIVATE KEY-----/);
  assert.match(repaired.pin, /^[0-9a-f]{64}$/);
});

test('resetBridgeIdentity: 删除身份文件；目录不存在也不抛错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pc-bridge-id-'));
  const id = ensureBridgeIdentity(dir, ['10.1.2.3']);
  resetBridgeIdentity(dir);
  assert.equal(existsSync(join(dir, 'pc-bridge-key.pem')), false);
  assert.equal(existsSync(join(dir, 'pc-bridge-cert.pem')), false);
  // 重置后再建：指纹变化（旧配对应被 FAIL_PIN 阻断）
  const reborn = ensureBridgeIdentity(dir, ['10.1.2.3']);
  assert.notEqual(reborn.pin, id.pin);
  // 不存在的目录：幂等
  resetBridgeIdentity(join(tmpdir(), 'pc-bridge-no-such-dir-xyz'));
});
