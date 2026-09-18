// SPDX-License-Identifier: MIT
// main/pc-bridge-http.test.ts -- D4 PC 桥接 HTTPS server 单测（node:test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import net from 'node:net';
import { createHash, createPublicKey } from 'node:crypto';

import {
  enableBridge,
  disableBridge,
  getBridgeInfo,
  resolveBindHost,
  PC_BRIDGE_LOOPBACK_HOST,
  PC_BRIDGE_LAN_HOST,
  type UsageSummary,
} from './pc-bridge-http.js';

import { V1_FIXTURE } from './pc-bridge-schema.js';
import { generateBridgeIdentity } from './pc-bridge-tls.js';

// 用 port=0 拿 OS 临时端口：开发机可能已有 0.0.0.0:8453 占用（Windows 下
// 127.0.0.1 特定绑定可与之共存，但会污染关闭后重连/LAN 重绑的断言）。
let PORT = 0;

// 冻结 v1 契约的固定样本（与 Android PcUsageFetcherTest 的成功报文为同一字面量）。
const SAMPLE: UsageSummary = V1_FIXTURE;

function makeDeps() {
  return { getUsageSummary: async (): Promise<UsageSummary> => SAMPLE };
}

interface TlsReply {
  status: number;
  body: string;
  contentType: string;
  leafPem: string;
  authorized: boolean;
  authError: string | null;
}

function rawTlsRequest(path: string, opts: { ca?: string; rejectUnauthorized?: boolean } = {}): Promise<TlsReply> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      PORT,
      PC_BRIDGE_LOOPBACK_HOST,
      {
        rejectUnauthorized: opts.rejectUnauthorized ?? false,
        ca: opts.ca,
      },
      () => {
        sock.write(`GET ${path} HTTP/1.1\r\nHost: pc-bridge\r\nConnection: close\r\n\r\n`);
      },
    );
    const chunks: Buffer[] = [];
    // peer cert 必须在连接仍存活时取（close 后 getPeerCertificate 返回空）
    let leafPem = '';
    sock.once('secureConnect', () => {
      const peer = sock.getPeerCertificate(false);
      if (peer) leafPem = pemFromDer(peer.raw);
    });
    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('error', reject);
    sock.on('close', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const split = raw.indexOf('\r\n\r\n');
      const head = split >= 0 ? raw.slice(0, split) : raw;
      const body = split >= 0 ? raw.slice(split + 4) : '';
      const lines = head.split('\r\n');
      const status = Number((lines[0] ?? '').split(' ')[1] ?? 0);
      const contentType = (lines.find((l) => l.toLowerCase().startsWith('content-type:')) ?? '')
        .slice('content-type:'.length)
        .trim();
      resolve({
        status,
        body,
        contentType,
        leafPem,
        authorized: sock.authorized,
        authError: sock.authorizationError?.message ?? null,
      });
    });
  });
}

function pemFromDer(der: Buffer): string {
  const b64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

function pinFromPem(pem: string): string {
  const spki = createPublicKey(pem).export({ type: 'spki', format: 'der' }) as Buffer;
  return createHash('sha256').update(spki).digest('hex');
}

function tlsHandshakeOnly(ca?: string): Promise<{ authorized: boolean; pin: string }> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      PORT,
      PC_BRIDGE_LOOPBACK_HOST,
      { rejectUnauthorized: !!ca, ca },
      () => {
        const peer = sock.getPeerCertificate(false);
        const pin = peer ? pinFromPem(pemFromDer(peer.raw)) : '';
        const authorized = sock.authorized;
        sock.destroy();
        resolve({ authorized, pin });
      },
    );
    sock.on('error', reject);
  });
}

// 注意：node:test 在单文件内默认顺序执行，server 生命周期贯穿各用例。
test('S3 默认仅绑 127.0.0.1；配对信息为 https + spki256 指纹', async () => {
  const info = await enableBridge(makeDeps(), { port: 0 });
  PORT = info.port;
  assert.equal(info.enabled, true);
  assert.equal(info.host, PC_BRIDGE_LOOPBACK_HOST);
  assert.equal(info.ip, PC_BRIDGE_LOOPBACK_HOST);
  assert.equal(info.lan, false);
  assert.equal(info.tls, true);
  assert.ok(info.port > 0, 'port=0 时应采纳 OS 分配端口');
  assert.equal(typeof info.token, 'string');
  assert.equal(info.token!.length, 32);
  assert.match(info.spki256 ?? '', /^[0-9a-f]{64}$/);
  assert.equal(
    info.url,
    `https://127.0.0.1:${PORT}/api/usage/summary?token=${info.token}#spki256=${info.spki256}`,
  );
  // 未带 token 应 401（真实在监听）
  const probe = await rawTlsRequest('/api/usage/summary');
  assert.equal(probe.status, 401);
});

test('TLS 握手成功且叶子证书 SPKI 指纹与 QR 公告一致（TOFU 契约）', async () => {
  const info = getBridgeInfo();
  const h = await tlsHandshakeOnly();
  assert.equal(h.pin, info.spki256);
});

test('用服务器自签证书作 CA（IP SAN=127.0.0.1）严格校验可通过', async () => {
  // 内部自签身份不直接可见；通过握手叶子 PEM 自证一次严格链
  const probe = await rawTlsRequest('/api/usage/summary');
  const strict = await tlsHandshakeOnly(probe.leafPem);
  assert.equal(strict.authorized, true, `authorizationError 不应出现`);
  assert.equal(strict.pin, getBridgeInfo().spki256);
});

test('无 token 访问 → 401 + JSON 错误体', async () => {
  const res = await rawTlsRequest('/api/usage/summary');
  assert.equal(res.status, 401);
  assert.match(res.contentType, /^application\/json/);
  const parsed = JSON.parse(res.body) as { error?: { code?: string } };
  assert.equal(parsed.error?.code, 'UNAUTHORIZED');
});

test('错 token 访问 → 401', async () => {
  const res = await rawTlsRequest('/api/usage/summary?token=deadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.body).error.code, 'UNAUTHORIZED');
});

test('未知路径 / 非 GET → 404 + JSON 错误体', async () => {
  const res = await rawTlsRequest(`/api/usage/nope?token=${getBridgeInfo().token}`);
  assert.equal(res.status, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});

test('正确 token 访问 → 200 + v1 契约形状', async () => {
  const token = getBridgeInfo().token;
  assert.ok(token, 'bridge 应已 enable 且持有 token');
  const res = await rawTlsRequest(`/api/usage/summary?token=${token}`);
  assert.equal(res.status, 200);
  assert.match(res.contentType, /^application\/json/);
  const parsed = JSON.parse(res.body) as UsageSummary & Record<string, unknown>;
  assert.deepEqual(parsed, SAMPLE);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.today.date, '2026-09-17');
  assert.equal(parsed.today.totalTokens, 1234);
  assert.deepEqual(parsed.today.bySource.codex, { tokens: 1000, costUsd: 0.1 });
  assert.deepEqual(parsed.today.topProjects, []);
  assert.equal('window5h' in parsed, false);
});

test('明文 HTTP 无法连接：8453 只说 TLS（无 http/https 歧义）', async () => {
  await assert.rejects(
    () =>
      new Promise<void>((_resolve, reject) => {
        const sock = net.connect(PORT, PC_BRIDGE_LOOPBACK_HOST, () => {
          sock.write('GET /api/usage/summary HTTP/1.1\r\nHost: x\r\n\r\n');
        });
        sock.on('error', (e) => {
          clearTimeout(timer);
          sock.destroy();
          reject(e);
        });
        sock.on('close', () => {
          clearTimeout(timer);
          reject(new Error('plaintext socket closed'));
        });
        const timer = setTimeout(() => {
          sock.destroy();
          reject(new Error('timeout'));
        }, 3000);
      }),
  );
});

test('disableBridge() 后 server 关闭、token 清空（身份保留供下次 enable 复用）', async () => {
  await disableBridge();
  const info = getBridgeInfo();
  assert.equal(info.enabled, false);
  assert.equal(info.token, null);
  assert.equal(info.url, null);
  // 身份刻意保留（disable 不等同重置身份）；resetBridgeIdentity 才轮换
  assert.match(info.spki256 ?? '', /^[0-9a-f]{64}$/);
  await assert.rejects(() => tlsHandshakeOnly());
});

test('resolveBindHost：默认回环；lan=true 才绑 0.0.0.0；显式 host 覆盖', () => {
  assert.equal(resolveBindHost(), PC_BRIDGE_LOOPBACK_HOST);
  assert.equal(resolveBindHost({}), PC_BRIDGE_LOOPBACK_HOST);
  assert.equal(resolveBindHost({ lan: false }), PC_BRIDGE_LOOPBACK_HOST);
  assert.equal(resolveBindHost({ lan: true }), PC_BRIDGE_LAN_HOST);
  assert.equal(resolveBindHost({ lan: true, host: '192.168.1.9' }), '192.168.1.9');
  assert.equal(resolveBindHost({ lan: false, host: '127.0.0.1' }), '127.0.0.1');
});

test('LAN 模式（显式同意 + 注入身份）：绑 0.0.0.0，url 公告局域网 IP + 该证书指纹', async () => {
  const id = generateBridgeIdentity(['192.0.2.77']);
  const info = await enableBridge(makeDeps(), { lan: true, identity: id, port: 0 });
  PORT = info.port;
  assert.equal(info.host, PC_BRIDGE_LAN_HOST);
  assert.equal(info.lan, true);
  assert.equal(info.spki256, id.pin);
  assert.ok(info.url?.startsWith('https://'), 'url 必须是 https');
  assert.ok(info.url?.includes(`#spki256=${id.pin}`), 'url 必须公告注入身份的指纹');
  // 回环地址仍可连通（0.0.0.0 包含回环网卡）
  const res = await rawTlsRequest(`/api/usage/summary?token=${info.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.leafPem.length > 0, true);
  assert.equal(pinFromPem(res.leafPem), id.pin);
  await disableBridge();
});
