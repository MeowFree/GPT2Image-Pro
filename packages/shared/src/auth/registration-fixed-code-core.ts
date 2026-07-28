/**
 * 固定注册邀请码的 DB-free 纯逻辑。
 *
 * 使用方：registration-fixed-code.ts 负责读取运行时设置，本模块只负责配置边界与恒定时间比较。
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const REGISTRATION_FIXED_CODE_MIN_LENGTH = 8;
export const REGISTRATION_FIXED_CODE_MAX_LENGTH = 128;

/**
 * 规范化并校验部署侧固定邀请码。
 *
 * @param value 系统设置或环境变量中的原始值。
 * @returns 未配置时返回 null，配置合法时返回去除首尾空白后的邀请码。
 * @throws 配置长度不合法时抛错并关闭注册页，避免误配置后绕过验证。
 */
export function normalizeRegistrationFixedCode(
  value: string | null | undefined
) {
  const normalized = value?.trim();
  if (!normalized) return null;

  if (
    normalized.length < REGISTRATION_FIXED_CODE_MIN_LENGTH ||
    normalized.length > REGISTRATION_FIXED_CODE_MAX_LENGTH
  ) {
    throw new Error(
      `REGISTRATION_FIXED_VERIFICATION_CODE must contain ${REGISTRATION_FIXED_CODE_MIN_LENGTH}-${REGISTRATION_FIXED_CODE_MAX_LENGTH} characters`
    );
  }

  return normalized;
}

/**
 * 使用固定长度摘要做恒定时间比较，避免从响应时间推断邀请码内容或长度。
 *
 * @param configuredCode 服务端已校验的固定邀请码。
 * @param inputCode 用户提交的邀请码。
 * @returns 两者去除首尾空白后完全一致时返回 true。
 */
export function matchesRegistrationFixedCode(
  configuredCode: string,
  inputCode: string
) {
  const configuredDigest = createHash("sha256").update(configuredCode).digest();
  const inputDigest = createHash("sha256").update(inputCode.trim()).digest();
  return timingSafeEqual(configuredDigest, inputDigest);
}
