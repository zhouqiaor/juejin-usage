// SPDX-License-Identifier: MIT
// shared/subscription-prefs.ts — Cursor/MiniMax/火山引擎三家订阅开关
//
// 语义：
//   - 默认全部关闭（opt-in），用户在「设置 → 余量凭证」手动开启；
//   - 首次读到无 subscriptionPrefs 的老用户，main 侧做一次性本机可用性探测
//     （只读本机凭据文件/keystore，不发网络请求），探测到即开启并落 migratedAt；
//   - 迁移之后严格尊重用户选择，可用性探测结果不再回灌。
//
// 零 React/Electron/DOM 依赖，可在 node:test 下独立验证。

/** 受开关控制的三家订阅 provider key（与 pet-quota-providers 的 key 对齐）。 */
export type SubscriptionProviderKey = 'cursor' | 'minimax' | 'ark';

export interface SubscriptionPrefs {
  cursor: boolean;
  minimax: boolean;
  ark: boolean;
  /** 一次性迁移完成时间（ISO 字符串）；null = 尚未迁移。 */
  migratedAt: string | null;
}

export type SubscriptionAvailability = Record<SubscriptionProviderKey, boolean>;

/** 通道名集中在 shared，preload/main 共用同一份字面量。 */
export const SUBSCRIPTION_PREFS_GET_CHANNEL = 'subscription-prefs:get';
export const SUBSCRIPTION_PREFS_SET_CHANNEL = 'subscription-prefs:set';
export const SUBSCRIPTION_PREFS_CHANGED_CHANNEL = 'subscription-prefs:changed';

export const DEFAULT_SUBSCRIPTION_PREFS: SubscriptionPrefs = {
  cursor: false,
  minimax: false,
  ark: false,
  migratedAt: null,
};

const PROVIDER_KEYS: readonly SubscriptionProviderKey[] = ['cursor', 'minimax', 'ark'];

export function isSubscriptionProviderKey(value: unknown): value is SubscriptionProviderKey {
  return value === 'cursor' || value === 'minimax' || value === 'ark';
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * 把磁盘上的未知值清洗成合法 prefs。字段缺失/类型错误一律按 false 处理
 * （迁移后的语义是「严格尊重用户选择」：没有显式 true 就不开）。
 * migratedAt 只接受非空字符串。
 */
export function sanitizeSubscriptionPrefs(value: unknown): SubscriptionPrefs | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const migratedAt = typeof record.migratedAt === 'string' && record.migratedAt.trim()
    ? record.migratedAt
    : null;
  const cursor = asBoolean(record.cursor);
  const minimax = asBoolean(record.minimax);
  const ark = asBoolean(record.ark);
  // 三个布尔都缺失且无戳记：视为「没有这份 prefs」，交给迁移流程。
  if (cursor === undefined && minimax === undefined && ark === undefined && !migratedAt) {
    return null;
  }
  return {
    cursor: cursor ?? false,
    minimax: minimax ?? false,
    ark: ark ?? false,
    migratedAt,
  };
}

/**
 * 纯函数决策入口：
 *   - stored 为已迁移 prefs（sanitize 非 null）→ 严格尊重，availability 被忽略；
 *   - stored 为空 → 用一次性可用性探测结果填充，enabled = 探测到可用，
 *     并打上 migratedAt 戳记（戳记由调用方注入，通常是 new Date().toISOString()）。
 */
export function resolveSubscriptionPrefs(
  stored: unknown,
  availability: SubscriptionAvailability,
  migratedAt: string,
): SubscriptionPrefs {
  const sanitized = sanitizeSubscriptionPrefs(stored);
  if (sanitized) return sanitized;
  const prefs: SubscriptionPrefs = { ...DEFAULT_SUBSCRIPTION_PREFS, migratedAt };
  for (const key of PROVIDER_KEYS) {
    prefs[key] = availability[key] === true;
  }
  return prefs;
}

/** set IPC 的入参清洗：只接受三家布尔的局部更新，migratedAt 不允许 renderer 改。 */
export function patchSubscriptionPrefs(
  current: SubscriptionPrefs,
  patch: unknown,
): SubscriptionPrefs | null {
  if (!patch || typeof patch !== 'object') return null;
  const record = patch as Record<string, unknown>;
  const next: SubscriptionPrefs = { ...current };
  let changed = false;
  for (const key of PROVIDER_KEYS) {
    const value = asBoolean(record[key]);
    if (value !== undefined && value !== next[key]) {
      next[key] = value;
      changed = true;
    }
  }
  return changed ? next : null;
}

/** 受开关控制的 key 集合（供 renderer 扇出过滤用）。 */
export function enabledSubscriptionKeys(prefs: SubscriptionPrefs): ReadonlySet<SubscriptionProviderKey> {
  return new Set(PROVIDER_KEYS.filter((key) => prefs[key]));
}
