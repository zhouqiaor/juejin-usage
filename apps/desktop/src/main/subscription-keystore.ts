// SPDX-License-Identifier: MIT
// main/subscription-keystore.ts -- Electron safeStorage encrypted credential store
import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export interface SubscriptionKeyStore {
  minimax?: { apiKey: string; region?: 'auto' | 'global' | 'mainland'; };
  ark?: { accessKeyId: string; secretAccessKey: string; region?: string; };
}
export interface SubscriptionKeyStatus {
  plan: 'minimax' | 'ark';
  source: 'env' | 'stored' | 'none';
  masked: string | null;
  region?: string | null;
}
export interface SubscriptionKeySaveResult { success: boolean; message: string; data?: SubscriptionKeyStatus[]; }

const KEYSTORE_FILENAME = 'subscription-keys.enc.json';

function keystorePath(): string { return join(app.getPath('userData'), KEYSTORE_FILENAME); }

function encrypt(plain: string): string { return safeStorage.encryptString(plain).toString('base64'); }
function decrypt(cipher: string): string { return safeStorage.decryptString(Buffer.from(cipher, 'base64')); }

// ---- 诊断日志：仅记录原因，不泄露凭据明文/密文值（P1-③ 消除静默失败） ----
function logKeystoreWarn(msg: string): void { console.warn(`[subscription-keystore] ${msg}`); }
function logKeystoreError(msg: string, err?: unknown): void {
  if (err instanceof Error) console.error(`[subscription-keystore] ${msg}: ${err.message}`);
  else console.error(`[subscription-keystore] ${msg}`);
}

// safeStorage 是否可用：测试/未就绪/密钥被重置场景下可能不可用，须显式判定
function isCryptoReady(): boolean {
  if (typeof safeStorage === 'undefined' || typeof app === 'undefined') return false;
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

// ---- 纯函数层：便于单测，不依赖 electron / 文件系统 ----
export type DecryptFn = (cipher: string) => string;

export function serializeStore(store: SubscriptionKeyStore, encryptFn: (plain: string) => string): Record<string, string> {
  const cipherObj: Record<string, string> = {};
  if (store.minimax) {
    cipherObj['minimax|apiKey'] = encryptFn(store.minimax.apiKey);
    if (store.minimax.region) cipherObj['minimax|region'] = encryptFn(store.minimax.region);
  }
  if (store.ark) {
    cipherObj['ark|accessKeyId'] = encryptFn(store.ark.accessKeyId);
    cipherObj['ark|secretAccessKey'] = encryptFn(store.ark.secretAccessKey);
    if (store.ark.region) cipherObj['ark|region'] = encryptFn(store.ark.region);
  }
  return cipherObj;
}

export interface ParseStoreResult { store: SubscriptionKeyStore; corruptFieldCount: number; }

// 逐字段解密：单个字段损坏只跳过该字段并保留其余凭据（P1-① 容错）。
// 注意：损坏字段必须保持「缺失(undefined)」而非初始化空串，否则会产生
// secretAccessKey='' 这类半截凭据，被 resolveArkCredentials 当作有效值外发。
export function parseStore(cipherObj: Record<string, string>, decryptFn: DecryptFn): ParseStoreResult {
  const out: { minimax?: Record<string, string>; ark?: Record<string, string> } = {};
  let corruptFieldCount = 0;
  for (const [k, v] of Object.entries(cipherObj)) {
    const sep = k.indexOf('|');
    if (sep < 0) { corruptFieldCount++; continue; }
    const group = k.slice(0, sep);
    const field = k.slice(sep + 1);
    if (group !== 'minimax' && group !== 'ark') { corruptFieldCount++; continue; }
    try {
      const decoded = decryptFn(v);
      out[group] = out[group] ?? {};
      out[group]![field] = decoded;
    } catch {
      corruptFieldCount++;
    }
  }
  return { store: out as unknown as SubscriptionKeyStore, corruptFieldCount };
}

// 原子写：先写临时文件再 rename，避免中途崩溃留下截断文件导致全库凭据丢失（P1-②）
export function atomicWriteFile(p: string, content: string): void {
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, p);
}

function readStore(): SubscriptionKeyStore | null {
  let p: string;
  try { p = keystorePath(); } catch { return null; }
  if (!existsSync(p)) { return null; }
  if (!isCryptoReady()) {
    logKeystoreError('safeStorage 加密不可用，无法读取已保存凭据（OS 密钥链可能未就绪或被重置），已忽略存储凭据');
    return null;
  }
  try {
    const raw = readFileSync(p, 'utf8');
    const cipherObj = JSON.parse(raw) as Record<string, string>;
    const { store, corruptFieldCount } = parseStore(cipherObj, decrypt);
    if (corruptFieldCount > 0) {
      logKeystoreWarn(`凭据库存在 ${corruptFieldCount} 个无法解密的字段，已跳过损坏字段并保留其余凭据（可能因密钥重置导致）`);
    }
    return store;
  } catch (e) {
    logKeystoreError('凭据库文件损坏或无法解析，已忽略已保存的凭据', e);
    return null;
  }
}

function writeStore(store: SubscriptionKeyStore): void {
  const p = keystorePath();
  const cipherObj = serializeStore(store, encrypt);
  atomicWriteFile(p, JSON.stringify(cipherObj));
}

function clearStore(): void {
  const p = keystorePath();
  if (existsSync(p)) atomicWriteFile(p, '{}');
}

export function mask(s: string): string { return s.length <= 4 ? '****' : '****' + s.slice(-4); }

function getEnvKeys(): SubscriptionKeyStore {
  return {
    minimax: (process.env.MINIMAX_API_KEY || process.env.MINIMAX_CODING_KEY)
      ? { apiKey: process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_CODING_KEY ?? '', region: (process.env.MINIMAX_REGION as 'auto' | 'global' | 'mainland') ?? 'auto' }
      : undefined,
    ark: (process.env.VOLC_ACCESS_KEY_ID && process.env.VOLC_SECRET_ACCESS_KEY)
      ? { accessKeyId: process.env.VOLC_ACCESS_KEY_ID, secretAccessKey: process.env.VOLC_SECRET_ACCESS_KEY, region: process.env.VOLC_REGION }
      : undefined,
  };
}

export function getKeyStatus(): SubscriptionKeyStatus[] {
  const env = getEnvKeys();
  const stored = readStore() ?? {};
  const r: SubscriptionKeyStatus[] = [];
  if (env.minimax) r.push({ plan: 'minimax', source: 'env', masked: mask(env.minimax.apiKey), region: env.minimax.region ?? null });
  else if (stored.minimax) r.push({ plan: 'minimax', source: 'stored', masked: mask(stored.minimax.apiKey), region: stored.minimax.region ?? null });
  else r.push({ plan: 'minimax', source: 'none', masked: null, region: null });
  if (env.ark) r.push({ plan: 'ark', source: 'env', masked: mask(env.ark.accessKeyId), region: env.ark.region ?? null });
  else if (stored.ark) r.push({ plan: 'ark', source: 'stored', masked: mask(stored.ark.accessKeyId), region: stored.ark.region ?? null });
  else r.push({ plan: 'ark', source: 'none', masked: null, region: null });
  return r;
}

export function saveKeys(keys: SubscriptionKeyStore): SubscriptionKeySaveResult {
  if (!isCryptoReady()) {
    return { success: false, message: '当前系统不支持安全加密存储，请改用环境变量方式配置凭据。' };
  }
  const existing = readStore() ?? {};
  const merged: SubscriptionKeyStore = { minimax: keys.minimax ?? existing.minimax, ark: keys.ark ?? existing.ark };
  writeStore(merged);
  return { success: true, message: '凭据已保存。', data: getKeyStatus() };
}

export function clearKeys(plan: 'minimax' | 'ark'): SubscriptionKeySaveResult {
  if (!isCryptoReady()) {
    return { success: false, message: '当前系统不支持安全加密存储，无法清除已保存的凭据。' };
  }
  const existing = readStore() ?? {};
  if (plan === 'minimax') delete existing.minimax;
  else delete existing.ark;
  if (Object.keys(existing).length === 0) clearStore();
  else writeStore(existing);
  return { success: true, message: plan === 'minimax' ? 'MiniMax 凭据已清除。' : '火山方舟 凭据已清除。', data: getKeyStatus() };
}

export function resolveMiniMaxCredentials(): { token: string; region: 'auto' | 'global' | 'mainland' } | null {
  const env = getEnvKeys();
  if (env.minimax) return { token: env.minimax.apiKey, region: env.minimax.region ?? 'auto' };
  const s = readStore();
  if (s?.minimax) return { token: s.minimax.apiKey, region: (s.minimax.region as 'auto' | 'global' | 'mainland') ?? 'auto' };
  return null;
}

export function resolveArkCredentials(): { accessKeyId: string; secretAccessKey: string; region: string } | null {
  const env = getEnvKeys();
  if (env.ark) return { accessKeyId: env.ark.accessKeyId, secretAccessKey: env.ark.secretAccessKey, region: env.ark.region ?? 'cn-beijing' };
  const s = readStore();
  if (s?.ark) return { accessKeyId: s.ark.accessKeyId, secretAccessKey: s.ark.secretAccessKey, region: s.ark.region ?? 'cn-beijing' };
  return null;
}
