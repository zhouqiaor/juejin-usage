// SPDX-License-Identifier: MIT
// main/pc-bridge-http.ts
//
// D4 数据通路第一阶段：juejin-usage 桌面端「局域网 HTTP 桥接」。
//
// - 监听独立端口 8453（与 sidecar 8452 隔离），仅暴露 GET /api/usage/summary
// - 用一次性临时 token 做鉴权（每次 enable 轮换），PlanPulse 通过 QR 配对后周期拉取
// - 纯 node:http 实现，不引用 electron，因此可在 node:test 中直接单测
//
// 设计文档：tools/quota-app-android/docs/DESIGN-2026-09-16-juejin-sync.md（方案 1）
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';

export const PC_BRIDGE_DEFAULT_HOST = '0.0.0.0';
export const PC_BRIDGE_DEFAULT_PORT = 8453;
export const PC_BRIDGE_PATH = '/api/usage/summary';

/**
 * 用量摘要载荷。
 * 第一阶段直接透传 core 现有 summary（来自 aggregateCache.getUsageSummary），
 * 后续可收敛为设计文档 §三 的 UsageSummary schema（asOf/version/today/window5h）。
 */
export type UsageSummary = unknown;

export interface PcBridgeDeps {
  /** 返回当前用量摘要；由 desktop 端用 local-runtime 的 aggregateCache 提供。 */
  getUsageSummary: () => UsageSummary | Promise<UsageSummary>;
}

export interface PcBridgeInfo {
  /** server 是否在监听 */
  enabled: boolean;
  /** 实际绑定的 host（通常为 0.0.0.0） */
  host: string;
  /** 监听端口 */
  port: number;
  /** 局域网 IP，供 PlanPulse 配对与生成 QR */
  ip: string;
  /** 当前临时 token；未 enable 时为 null */
  token: string | null;
  /** 配对 URL（含临时 token），PlanPulse 扫描后直连拉取；未 enable 时为 null */
  url: string | null;
}

let server: Server | null = null;
let host: string = PC_BRIDGE_DEFAULT_HOST;
let port: number = PC_BRIDGE_DEFAULT_PORT;
let token: string | null = null;
let deps: PcBridgeDeps | null = null;

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

function buildPairingUrl(ip: string, p: number, t: string): string {
  return `http://${ip}:${p}${PC_BRIDGE_PATH}?token=${t}`;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const rawUrl = req.url ?? '/';
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, `http://${host}:${port}`);
  } catch {
    res.statusCode = 400;
    res.end();
    return;
  }

  if (req.method !== 'GET' || parsed.pathname !== PC_BRIDGE_PATH) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
    return;
  }

  const provided = parsed.searchParams.get('token');
  if (!token || provided !== token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Unauthorized');
    return;
  }

  Promise.resolve(deps ? deps.getUsageSummary() : null)
    .then((summary: UsageSummary) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(summary));
    })
    .catch((err: unknown) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(err instanceof Error ? err.message : 'Internal error');
    });
}

export function getBridgeInfo(): PcBridgeInfo {
  const ip = getLocalIp();
  const url = token ? buildPairingUrl(ip, port, token) : null;
  return {
    enabled: server !== null,
    host,
    port,
    ip,
    token,
    url,
  };
}

/**
 * 启动（或轮换 token）桥接 server。
 * 已运行时只轮换 token 不重建 server，避免端口抖动。
 */
export async function enableBridge(
  input: PcBridgeDeps,
  opts?: { host?: string; port?: number },
): Promise<PcBridgeInfo> {
  deps = input;
  host = opts?.host ?? PC_BRIDGE_DEFAULT_HOST;
  port = opts?.port ?? PC_BRIDGE_DEFAULT_PORT;

  if (server) {
    token = generateToken();
    return getBridgeInfo();
  }

  token = generateToken();
  server = createServer(handleRequest);
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(port, host, () => {
      server!.removeAllListeners('error');
      resolve();
    });
  });
  return getBridgeInfo();
}

/** 关闭 server 并清除 token。 */
export async function disableBridge(): Promise<void> {
  token = null;
  const current = server;
  server = null;
  if (!current) return;
  await new Promise<void>((resolve) => {
    current.close(() => resolve());
  });
}
