// SPDX-License-Identifier: MIT
// shared/ark-credentials.ts — 火山引擎 Ark 凭证纯校验（零依赖，renderer/main/test 共用）
//
// 口径与 Android 端 CredStore.validArkAk 一致：余量查询使用 IAM 访问密钥，
// AccessKey ID 必须以 AKLT 开头；ark- 开头的是推理 API Key，不可用于余量查询。
export const ARK_ACCESS_KEY_PREFIX = 'AKLT';
const ARK_ACCESS_KEY_RE = /^AKLT[0-9A-Za-z]+$/;

/**
 * 保存通道校验：非空 AccessKey ID 必须为 AKLT 开头的 IAM 密钥。
 * 空串视为「本次不提交」，返回 null（必填由调用方按需处理）。
 * env 通道不经过此校验——只拦 UI 手输保存。
 * @returns 中文错误信息；合法或为空时返回 null
 */
export function validateArkAccessKeyIdForSave(accessKeyId: string): string | null {
  const ak = accessKeyId.trim();
  if (ak.length === 0) return null;
  if (!ak.startsWith(ARK_ACCESS_KEY_PREFIX)) {
    return 'AccessKey ID 必须以 AKLT 开头：余量查询需要火山引擎「访问控制（IAM）」的访问密钥，ark- 开头的推理 API Key 不可用。';
  }
  if (!ARK_ACCESS_KEY_RE.test(ak)) {
    return 'AccessKey ID 形态不正确（应为 AKLT 开头的字母数字串），请检查是否复制完整、未混入空格。';
  }
  return null;
}
