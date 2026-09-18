// SPDX-License-Identifier: MIT
// main/pc-bridge-tls.ts
//
// D4 PC bridge TLS（方案 D / TOFU）：本地自签证书身份 + SPKI SHA-256 指纹。
//
// - 零新依赖：用 node:crypto 生成 RSA-2048 密钥，手写最小 ASN.1/DER 编码器产出
//   X.509 v3 自签证书（SHA256withRSA）；证书 SAN 含 127.0.0.1 与用户显式同意的
//   局域网 IPv4（IP 类型 SAN）。
// - 配对指纹 = SubjectPublicKeyInfo 的 SHA-256（小写 hex），与 Android 端
//   PcTlsClient.kt 的 spkiSha256Hex（MessageDigest(\"SHA-256\"), cert.publicKey.encoded）
//   逐字节同源；QR 以 `#spki256=<hex>` 公告。
// - 身份落盘在 Electron userData（IPC 层传入目录），文件权限 0600；
//   所需 SAN IP 集合变化（切换网卡/开关局域网）或显式「重置身份」时重新签发。
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BridgeIdentity {
  key: string; // PEM (PKCS#8)
  cert: string; // PEM (X.509)
  /** SPKI SHA-256，小写 64 hex（QR 公告指纹）。 */
  pin: string;
}

/** 证书寿命：10 年（UTC 时间编码，2050 前用 UTCTime 合法）。 */
const CERT_DAYS = 3650;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/* ============================ 最小 ASN.1 DER 编码器 ============================ */

function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function derInteger(value: number | Buffer): Buffer {
  const b = typeof value === 'number' ? Buffer.from([value]) : value;
  // 最高位为 1 时前补 0x00，防被解释成负数
  const body = b[0]! & 0x80 ? Buffer.concat([Buffer.from([0x00]), b]) : b;
  return tlv(0x02, body);
}

const derNull = (): Buffer => tlv(0x05, Buffer.alloc(0));

function derOid(arcs: number[]): Buffer {
  const out: number[] = [arcs[0]! * 40 + arcs[1]!];
  for (const arc of arcs.slice(2)) {
    const stack = [arc & 0x7f];
    let n = arc >>> 7;
    while (n > 0) {
      stack.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(...stack.reverse());
  }
  return tlv(0x06, Buffer.from(out));
}

const derUtf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, 'utf8'));
const derOctet = (b: Buffer): Buffer => tlv(0x04, b);
const derBitString = (content: Buffer, unusedBits = 0): Buffer =>
  tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), content]));
const derSeq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const derUtcTime = (d: Date): Buffer =>
  tlv(
    0x17,
    Buffer.from(
      d
        .toISOString()
        .replace(/[-:T]/g, '')
        .slice(2, 14) + 'Z',
    ),
  );

const OID_SHA256_WITH_RSA = [1, 2, 840, 113549, 1, 1, 11];
const OID_CN = [2, 5, 4, 3];
const OID_SKI = [2, 5, 29, 14];
const OID_SAN = [2, 5, 29, 17];
const OID_BASIC_CONSTRAINTS = [2, 5, 29, 19];
const OID_EXT_KEY_USAGE = [2, 5, 29, 37];
const OID_SERVER_AUTH = [1, 3, 6, 1, 5, 5, 7, 3, 1];

function algorithmIdentifier(oid: number[]): Buffer {
  return derSeq(derOid(oid), derNull());
}

function name(cn: string): Buffer {
  // Name ::= SEQUENCE OF RDN(SET OF SEQ{ OID, value })
  const attr = derSeq(derOid(OID_CN), derUtf8(cn));
  return derSeq(tlv(0x31, attr));
}

function sanExtension(names: Buffer, critical = false): Buffer {
  const parts = [derOid(OID_SAN)];
  if (critical) parts.push(derBoolean(true));
  parts.push(derOctet(names));
  return derSeq(...parts);
}

function derBoolean(v: boolean): Buffer {
  return tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
}

function extension(oid: number[], value: Buffer, critical = false): Buffer {
  const parts = [derOid(oid)];
  if (critical) parts.push(derBoolean(true));
  parts.push(derOctet(value));
  return derSeq(...parts);
}

/**
 * 生成自签 X.509 v3 证书。
 * @param lanIps 要写入 IP SAN 的局域网 IPv4（已由调用方经用户显式同意）；
 *               127.0.0.1 与 localhost 始终包含。
 */
export function generateBridgeIdentity(lanIps: readonly string[] = []): BridgeIdentity {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const pkcs1Der = publicKey.export({ type: 'pkcs1', format: 'der' }) as Buffer;

  const validIps = [...new Set(lanIps.map((ip) => ip.trim()).filter((ip) => IPV4_RE.test(ip)))];
  const dnsLocalhost = tlv(0x82, Buffer.from('localhost', 'ascii')); // [2] dNSName
  const ipNames = validIps.map((ip) =>
    tlv(0x87, Buffer.from(ip.split('.').map((o) => Number(o)))),
  ); // [7] iPAddress
  const ipLoopback = tlv(0x87, Buffer.from([127, 0, 0, 1]));
  const sanNames = derSeq(dnsLocalhost, ipLoopback, ...ipNames);

  const ski = createHash('sha1').update(pkcs1Der).digest(); // RFC 5280 §4.2.1.2 方法 1
  const notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(Date.now() + CERT_DAYS * 24 * 60 * 60 * 1000);

  const tbs = derSeq(
    tlv(0xa0, derInteger(Buffer.from([2]))), // [0] EXPLICIT version = v3
    derInteger(createHash('sha256').update(spkiDer).digest().subarray(0, 16)), // serial 128-bit
    algorithmIdentifier(OID_SHA256_WITH_RSA),
    name('PC Bridge'),
    derSeq(derUtcTime(notBefore), derUtcTime(notAfter)),
    name('PC Bridge'),
    spkiDer,
    tlv(
      0xa3, // [3] EXPLICIT extensions
      derSeq(
        extension(OID_SKI, derOctet(ski)),
        sanExtension(sanNames),
        extension(OID_BASIC_CONSTRAINTS, derSeq(), true), // cA 默认 false
        extension(OID_EXT_KEY_USAGE, derSeq(derOid(OID_SERVER_AUTH))),
      ),
    ),
  );

  const signature = signTbs(tbs, privateKey);
  const certDer = derSeq(tbs, algorithmIdentifier(OID_SHA256_WITH_RSA), derBitString(signature));
  const cert = derToPem(certDer, 'CERTIFICATE');
  const key = (privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).replace(/\r\n/g, '\n');
  return { key, cert, pin: spkiSha256FromPem(cert) };
}

function signTbs(tbsDer: Buffer, privateKey: KeyObject): Buffer {
  return createSign('sha256').update(tbsDer).sign(privateKey);
}

function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/** SPKI SHA-256 指纹（小写 64 hex）；与 Android spkiSha256Hex 同算法同编码。 */
export function spkiSha256FromPem(certPem: string): string {
  const spkiDer = createPublicKey(certPem).export({ type: 'spki', format: 'der' }) as Buffer;
  return createHash('sha256').update(spkiDer).digest('hex');
}

/* ============================ 文件身份库（IPC 层注入目录） ============================ */

const KEY_FILE = 'pc-bridge-key.pem';
const CERT_FILE = 'pc-bridge-cert.pem';

/** 从自签 PEM 中读出全部 IP SAN（node:crypto X509Certificate）。 */
export function certIpSans(certPem: string): string[] {
  const x509 = new X509Certificate(certPem);
  return (x509.subjectAltName ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('IP Address:'))
    .map((entry) => entry.slice('IP Address:'.length).trim());
}

/**
 * 读取或（按所需 SAN 集合）重新签发桥接身份。
 * 所需 IP 集合 = 127.0.0.1 + lanIps；与现有证书不一致即轮换（网卡/模式变化自动跟随）。
 * key.pem 以 0600 写入。
 */
export function ensureBridgeIdentity(dir: string, lanIps: readonly string[] = []): BridgeIdentity {
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, KEY_FILE);
  const certPath = join(dir, CERT_FILE);
  const required = [...new Set(['127.0.0.1', ...lanIps.map((ip) => ip.trim())])].sort();

  if (existsSync(keyPath) && existsSync(certPath)) {
    const cert = readFileSync(certPath, 'utf8');
    const key = readFileSync(keyPath, 'utf8');
    const have = certIpSans(cert).sort();
    if (have.length === required.length && have.every((ip, i) => ip === required[i])) {
      // 校验私钥仍可解析（损坏则重签）
      try {
        createPrivateKey(key);
        return { key, cert, pin: spkiSha256FromPem(cert) };
      } catch {
        // 落入重新签发
      }
    }
  }

  const identity = generateBridgeIdentity(lanIps);
  writeFileSync(keyPath, identity.key, { mode: 0o600 });
  writeFileSync(certPath, identity.cert, { mode: 0o644 });
  return identity;
}

/** 显式「重置身份」：删除落盘身份；下次 enable 重新签发，旧配对因指纹变更被 FAIL_PIN 阻断。 */
export function resetBridgeIdentity(dir: string): void {
  for (const f of [join(dir, KEY_FILE), join(dir, CERT_FILE)]) {
    try {
      unlinkSync(f);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
