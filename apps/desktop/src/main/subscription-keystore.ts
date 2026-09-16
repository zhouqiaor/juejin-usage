// SPDX-License-Identifier: MIT
// main/subscription-keystore.ts — Electron safeStorage 加密凭据库
import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

function readStore(): SubscriptionKeyStore | null {
  const p = keystorePath();
  if (!existsSync(p)) return null;
  try {
    const cipherObj = JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>;
    const plainObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cipherObj)) {
      try { plainObj[k] = decrypt(v as string); } catch { plainObj[k] = ''; }
    }
    return plainObj as unknown as SubscriptionKeyStore;
  } catch { return null; }
}
function writeStore(store: SubscriptionKeyStore): void {
  const p = keystorePath();
  const cipherObj: Record<string, string> = {};
  if (store.minimax) {
    cipherObj['minimax.apiKey'] = encrypt(store.minimax.apiKey);
    if (store.minimax.region) cipherObj['minimax.region'] = encrypt(store.minimax.region);
  }
  if (store.ark) {
    cipherObj['ark.accessKeyId'] = encrypt(store.ark.accessKeyId);
    cipherObj['ark.secretAccessKey'] = encrypt(store.ark.secretAccessKey);
    if (store.ark.region) cipherObj['ark.region'] = encrypt(store.ark.region);
  }
  writeFileSync(p, JSON.stringify(cipherObj), 'utf8');
}
function clearStore(): void {
  const p = keystorePath();
  if (existsSync(p)) writeFileSync(p, '{}', 'utf8');
}
function mask(s: string): string { return s.length <= 4 ? '****' : '****' + s.slice(-4); }

function getEnvKeys(): SubscriptionKeyStore {
  return {
    minimax: (process.env.MINIMAX_API_KEY || process.env.MINIMAX_CODING_KEY)
      ? { apiKey: process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_CODING_KEY ?? '', region: (process.env.MINIMAX_REGION as 'auto'|'global'|'mainland') ?? 'auto' }
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
  if (!safeStorage.isEncryptionAvailable()) return { success: false, message: '当前系统不支持安全加密存储，请改用环境变量方式配置凭据。' };
  const existing = readStore() ?? {};
  const merged: SubscriptionKeyStore = { minimax: keys.minimax ?? existing.minimax, ark: keys.ark ?? existing.ark };
  writeStore(merged);
  return { success: true, message: '凭据已保存。', data: getKeyStatus() };
}
export function clearKeys(plan: 'minimax' | 'ark'): SubscriptionKeySaveResult {
  const existing = readStore() ?? {};
  if (plan === 'minimax') delete existing.minimax; else delete existing.ark;
  if (Object.keys(existing).length === 0) clearStore(); else writeStore(existing);
  return { success: true, message: `${plan === 'minimax' ? 'MiniMax' : '火山方舟'} 凭据已清除。`, data: getKeyStatus() };
}
export function resolveMiniMaxCredentials(): { token: string; region: 'auto'|'global'|'mainland' } | null {
  const env = getEnvKeys();
  if (env.minimax) return { token: env.minimax.apiKey, region: env.minimax.region ?? 'auto' };
  const s = readStore();
  if (s?.minimax) return { token: s.minimax.apiKey, region: (s.minimax.region as 'auto'|'global'|'mainland') ?? 'auto' };
  return null;
}
export function resolveArkCredentials(): { accessKeyId: string; secretAccessKey: string; region: string } | null {
  const env = getEnvKeys();
  if (env.ark) return { accessKeyId: env.ark.accessKeyId, secretAccessKey: env.ark.secretAccessKey, region: env.ark.region ?? 'cn-beijing' };
  const s = readStore();
  if (s?.ark) return { accessKeyId: s.ark.accessKeyId, secretAccessKey: s.ark.secretAccessKey, region: s.ark.region ?? 'cn-beijing' };
  return null;
}
