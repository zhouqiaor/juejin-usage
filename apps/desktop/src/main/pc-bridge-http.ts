// SPDX-License-Identifier: MIT
// main/pc-bridge-http.ts
//
// D4 数据通路 MVP：juejin-usage 桌面端「局域网 HTTP 桥接」。
//
// - 监听独立端口 8453（与 sidecar 8452 隔离），仅暴露 GET /api/usage/summary
// - 128-bit token query 鉴权（enable 时生成、重复 enable 轮换、disable 清空）
// - 响应载荷冻结为 v1 契约（pc-bridge-schema.ts）；错误体为 JSON {error:{code,message}}
// - 纯 node:http 实现，不引用 electron，因此可在 node:test 中直接单测
//
// 设计文档：tools/quota-app-android/docs/DESIGN-2026-09-17-pcbridge-mvp.md
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { PcBridgeSummaryV1 } from './pc-bridge-schema.js';

export const PC_BRIDGE_DEFAULT_HOST = '0.0.0.0';
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
  /** 实际绑定的 host（通常为 0.0.0.0） */
  host: string;
  /** 监听端口 */
  port: number;
  /** 局域网 IP，供 PlanPulse 配对与生成 QR */
  ip: string;
  /** 当前临时 token；未 enable 时为 null */
  token: string | null;
  /** 配对 URL（含临时 token），PlanPulse 解析后直连拉取；未 enable 时为 null */
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
    parsed = new URL(rawUrl, `http://${host}:${port}`);
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
