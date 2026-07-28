/**
 * 固定注册邀请码模式。
 *
 * 使用方：注册页只读取是否启用；注册验证码服务读取邀请码。
 * 配置边界与恒定时间比较位于 DB-free 的 registration-fixed-code-core.ts。
 */
import { getRuntimeSettingString } from "../system-settings";
import { normalizeRegistrationFixedCode } from "./registration-fixed-code-core";

/**
 * 读取当前固定邀请码。
 *
 * @returns 未启用时返回 null；启用时返回服务端邀请码。
 * @throws 配置长度不合法时抛错，调用方必须按注册不可用处理。
 */
export async function getRegistrationFixedCode() {
  const configured = await getRuntimeSettingString(
    "REGISTRATION_FIXED_VERIFICATION_CODE"
  );
  return normalizeRegistrationFixedCode(configured);
}

/**
 * 判断注册页是否应显示邀请码输入模式。
 *
 * @returns 固定邀请码已正确配置时返回 true。
 * @throws 配置长度不合法时抛错，避免页面展示可用但服务端无法校验。
 */
export async function isRegistrationFixedCodeEnabled() {
  return Boolean(await getRegistrationFixedCode());
}
