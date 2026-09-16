// SPDX-License-Identifier: MIT
// shared/ark-error.ts — 火山引擎错误码 → 中文用户口径（零依赖纯函数）
// 对齐 Android 端 QuotaCodec.friendly；仅用于展示消息，不改重试/签名逻辑。

/**
 * 将上游错误串中的常见鉴权/时钟错误码翻译为中文说明；无命中时原样返回。
 */
export function friendlyArkError(err: string): string {
  if (!err) return err;
  if (err.includes('InvalidTimestamp') || err.includes('RequestExpired')) {
    return `时间戳失效：请检查本机系统时间（建议开启自动同步）后重试（${err}）`;
  }
  if (err.includes('SignatureDoesNotMatch')) {
    return `签名不匹配：SecretAccessKey 可能填错或含多余字符（${err}）`;
  }
  if (err.includes('InvalidAccessKey') || err.includes('InvalidAuthorization')) {
    return `AK 无效或推理 Key 无权限：火山余量必须用访问控制（IAM）的 AK/SK（${err}）`;
  }
  return err;
}
