/**
 * UOL Principal - 调用者身份模型
 *
 * 职责：定义所有可能的调用者身份类型及辅助判断函数。
 * Principal 贯穿整个 invoke 链路：传输层构造 → 网关鉴权 → execute 使用。
 *
 * 使用方：invoke.ts、access.ts、各 operation execute 函数
 * 关键依赖：auth/roles.ts（AppUserRole 类型）
 */
import type { AppUserRole } from "../auth/roles";

/**
 * Principal 联合类型 - 代表操作的调用者身份。
 *
 * - user: 通过会话登录的用户（含角色信息）
 * - apiKey: 通过 API key 鉴权的调用者（含套餐与中转标志）
 * - system: 系统内部调用（如初始化、后台任务）
 * - cron: 定时任务调用
 * - webhook: 外部 webhook 回调（支付平台等）
 * - proxy: 代理/网关层转发的请求
 */
export type Principal =
  | { type: "user"; userId: string; role: AppUserRole }
  | {
      type: "apiKey";
      userId: string;
      apiKeyId: string;
      plan: string;
      relayOnly: boolean;
    }
  | { type: "system"; reason: string }
  | { type: "cron"; job: string }
  | { type: "webhook"; provider: "creem" | "epay" }
  | { type: "proxy"; secretKind: "proxy" | "gateway" };

/**
 * 提取 Principal 中的 userId（仅 user 和 apiKey 拥有）。
 * 其他身份类型返回 null。
 */
export function getPrincipalUserId(p: Principal): string | null {
  switch (p.type) {
    case "user":
      return p.userId;
    case "apiKey":
      return p.userId;
    default:
      return null;
  }
}

/**
 * 判断 Principal 是否为管理员（admin 或 super_admin）。
 * 仅 user 类型可能为管理员。
 */
export function isPrincipalAdmin(p: Principal): boolean {
  return (
    p.type === "user" &&
    (p.role === "admin" || p.role === "super_admin")
  );
}

/**
 * 判断 Principal 是否为超级管理员。
 * 仅 user 类型且 role 为 super_admin。
 */
export function isPrincipalSuperAdmin(p: Principal): boolean {
  return p.type === "user" && p.role === "super_admin";
}
