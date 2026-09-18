// SPDX-License-Identifier: MIT
// main/pc-bridge-http.ts
//
// D4 数据通路：juejin-usage 桌面端「局域网 TLS 桥接」。
//
// - 监听独立端口 8453（与 sidecar 8452 隔离），仅暴露 GET /api/usage/summary
// - 128-bit token query 鉴权（enable 时生成、重复 enable 轮换、disable 清空）
// - 响应载荷冻结为 v1 契约（pc-bridge-schema.ts）；错误体为 JSON {error:{code,message}}
// - 仅提供 HTTPS（自签证书 + SPKI pin，指纹经配对 URL `#spki256=` 公告，TOFU）；
//   进程内从不启动明文 HTTP listener——不存在 http/https 同端口歧义。
// - S3 绑定策略（2026-09-18 硬化）：默认仅绑 127.0.0.1（回环）；
//   对局域网开放必须由调用方（设置 UI 的显式开关 + 同意文案）传 lan:true，
//   才绑 0.0.0.0 并把所选网卡 IP 写入证书 SAN 与配对 URL。
// - 纯 node:https 实现，不引用 electron，因此可在 node:test 中直接单测。
//
// 设计文档：tools/quota-app-android/docs/DESIGN-2026-09-17-pcbridge-mvp.md
import { createServer } from 'node:https';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { PcBridgeSummaryV1 } from './pc-bridge-schema.js';
import { generateBridgeIdentity, spkiSha256FromPem, type BridgeIdentity } from './pc-bridge-tls.js';

/** S3：回环模式绑定地址（默认，不接受局域网连接）。 */
export const PC_BRIDGE_LOOPBACK_HOST = '127.0.0.1';
/** S3：用户显式同意局域网开放后绑定的通配地址。 */
export const PC_BRIDGE_LAN_HOST = '0.0.0.0';
export const PC_BRIDGE_DEFAULT_PORT = 8453;
export const PC_BRIDGE_PATH = '/api/usage/summary';

/** v1 桥接载荷（冻结契约见 pc-bridge-schema.ts）。 */
export type UsageSummary = PcBridgeSummaryV1;

export interface PcBridgeDeps {
  /** 返回当前 v1 用量摘要；由 desktop 端经 IPC 层 mapper 提供。 */
  getUsageSummary: () => UsageSummary | Promise<UsageSummary>;
}

export interface PcBridgeInfo {
  /** server 是否在监听 */
  enabled: boolean;
  /** 实际绑定的 host：回环模式 127.0.0.1；局域网模式 0.0.0.0（经显式同意） */
  host: string;
  /** 监听端口 */
  port: number;
  /** 配对 URL 使用的公告 IP：回环=127.0.0.1；局域网=首个非 internal IPv4 */
  ip: string;
  /** 当前临时 token；未 enable 时为 null */
  token: string | null;
  /** 配对 URL（https + token + #spki256 指纹）；未 enable 时为 null */
  url: string | null;
  /** 恒为 true：桥接只提供 TLS（保留字段供 renderer/IPC 显式断言）。 */
  tls: boolean;
  /** 是否处于用户显式同意的局域网开放模式。 */
  lan: boolean;
  /** 服务器证书 SPKI SHA-256（小写 hex）；未 enable 时为 null。 */
  spki256: string | null;
}

export interface EnableBridgeOptions {
  /** 显式绑定地址（一般不传；优先级高于 lan 推导）。 */
  host?: string;
  port?: number;
  /** true=经用户显式同意开放局域网（绑 0.0.0.0）；缺省/false=仅回环。 */
  lan?: boolean;
  /** 注入已有身份（IPC 文件身份库/测试用）；缺省时进程内即时自签一份。 */
  identity?: BridgeIdentity;
}

let server: Server | null = null;
let host: string = PC_BRIDGE_LOOPBACK_HOST;
let port: number = PC_BRIDGE_DEFAULT_PORT;
let lanMode = false;
let token: string | null = null;
let identity: BridgeIdentity | null = null;
let deps: PcBridgeDeps | null = null;

/**
 * S3 绑定地址决策（纯函数）：
 * - 未显式同意局域网（lan 缺省/false）→ 仅 127.0.0.1；
 * - 显式同意 → 0.0.0.0（对所有网卡开放，风险由 UI 同意文案承担）；
 * - opts.host 仅作测试/高级覆盖，不改变 lan 语义。
 */
export function resolveBindHost(opts?: { lan?: boolean; host?: string }): string {
  if (opts?.host) return opts.host;
  return opts?.lan ? PC_BRIDGE_LAN_HOST : PC_BRIDGE_LOOPBACK_HOST;
}

/** 选第一个非内部 IPv4 地址作为局域网 IP；取不到则回落 127.0.0.1。 */
export function getLocalIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 配对 URL：https + token(query) + SPKI 指纹(fragment)。
 * 指纹放 fragment：不会进入 PC 访问日志/代理行；Android parseQr 同时兼容 query/fragment。
 */
function buildPairingUrl(ip: string, p: number, t: string, pin: string): string {
  return `https://${ip}:${p}${PC_BRIDGE_PATH}?token=${t}#spki256=${pin}`;
}

/** 常量时间字符串比较（长度不同时提前返回，不泄露 token 本身以外的信息）。 */
function tokenMatches(provided: string | null, expected: string | null): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sendError(res: ServerResponse, status: 400 | 401 | 404 | 500, code: string, message: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: { code, message } }));
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const rawUrl = req.url ?? '/';
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, `https://${host}:${port}`);
  } catch {
    sendError(res, 400, 'BAD_REQUEST', 'malformed request');
    return;
  }

  if (req.method !== 'GET' || parsed.pathname !== PC_BRIDGE_PATH) {
    sendError(res, 404, 'NOT_FOUND', 'unknown endpoint');
    return;
  }

  if (!tokenMatches(parsed.searchParams.get('token'), token)) {
    sendError(res, 401, 'UNAUTHORIZED', 'invalid or missing token');
    return;
  }

  Promise.resolve(deps ? deps.getUsageSummary() : null)
    .then((summary: UsageSummary | null) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(summary));
    })
    .catch(() => {
      // 原始错误只进主进程日志，不向局域网回传内部细节
      sendError(res, 500, 'INTERNAL', 'usage summary unavailable');
    });
}

export function getBridgeInfo(): PcBridgeInfo {
  const ip = lanMode ? getLocalIp() : PC_BRIDGE_LOOPBACK_HOST;
  const pin = identity ? spkiSha256FromPem(identity.cert) : null;
  const url = token && pin ? buildPairingUrl(ip, port, token, pin) : null;
  return {
    enabled: server !== null,
    host,
    port,
    ip,
    token,
    url,
    tls: true,
    lan: lanMode,
    spki256: pin,
  };
}

/**
 * 启动（或轮换 token）桥接 server。
 * - 仅 HTTPS：身份由 opts.identity 注入（IPC 落盘身份）或现场自签（测试/兜底）；
 * - 已运行时只轮换 token 不重建 server、不换证书（证书轮换走 resetBridgeIdentity）。
 */
export async function enableBridge(input: PcBridgeDeps, opts?: EnableBridgeOptions): Promise<PcBridgeInfo> {
  deps = input;
  host = resolveBindHost(opts);
  port = opts?.port ?? PC_BRIDGE_DEFAULT_PORT;
  lanMode = opts?.lan === true;

  if (server) {
    token = generateToken();
    return getBridgeInfo();
  }

  identity =
    opts?.identity ??
    // 兜底：调用方未注入身份（测试/裸用）。SAN 至少含回环；LAN 模式含所选网卡 IP。
    generateBridgeIdentity(lanMode ? [getLocalIp()] : []);
  token = generateToken();
  server = createServer({ key: identity.key, cert: identity.cert }, handleRequest);
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(port, host, () => {
      server!.removeAllListeners('error');
      // port=0 时采纳 OS 分配的临时端口（测试/端口冲突场景）
      const addr = server!.address();
      if (addr && typeof addr === 'object') port = addr.port;
      resolve();
    });
  });
  return getBridgeInfo();
}

/** 关闭 server 并清除 token（身份保留：下次 enable 复用同一证书，避免无谓 pin 变更）。 */
export async function disableBridge(): Promise<void> {
  token = null;
  const current = server;
  server = null;
  if (!current) return;
  await new Promise<void>((resolve) => {
    current.close(() => resolve());
  });
}
