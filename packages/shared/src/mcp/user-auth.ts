/**
 * MCP User 鉴权模块
 *
 * 职责：定义 MCP 用户密钥鉴权接口与默认占位实现。
 * 实际鉴权逻辑需要 DB 访问（查 mcp_api_key 表），因此设计为可绑定函数：
 * 传输层（route.ts）在运行时注入带 DB 的实现。
 *
 * 使用方：apps/web MCP user route handler
 * 关键依赖：../uol/principal.ts（Principal 类型）
 *
 * 设计决策：
 * - 将 DB 操作解耦到绑定函数中，保持 shared 包 DB-free 可测试
 * - 鉴权失败抛出包含 httpStatus 的 McpAuthError，便于传输层统一错误编码
 */
import type { Principal } from "../uol/principal";

/**
 * MCP 鉴权错误
 * 包含 HTTP 状态码以便传输层正确编码 JSON-RPC error response
 */
export class McpAuthError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 401) {
    super(message);
    this.name = "McpAuthError";
    this.httpStatus = httpStatus;
  }
}

/**
 * MCP User 鉴权函数签名。
 *
 * @param authHeader - 完整的 Authorization 头值（如 "Bearer mcp_xxx..."）
 * @returns Principal（type: "apiKey"，relayOnly 始终为 false）
 * @throws McpAuthError 鉴权失败时
 */
export type AuthenticateMcpUserKeyFn = (
  authHeader: string,
) => Promise<Principal>;

/**
 * 默认占位实现 - 未绑定实际 DB 逻辑时抛出配置错误。
 * 传输层启动时应通过 bindMcpUserAuth() 注入真实实现。
 */
let _authenticateFn: AuthenticateMcpUserKeyFn = async () => {
  throw new McpAuthError(
    "MCP User auth not configured. Call bindMcpUserAuth() at startup.",
    500,
  );
};

/**
 * 绑定 MCP User 鉴权的实际实现。
 *
 * 在应用启动时（route handler 初始化阶段）调用一次，
 * 注入带 DB 访问能力的鉴权函数。
 *
 * @param fn - 实际鉴权函数（查 mcp_api_key 表、校验用户状态等）
 */
export function bindMcpUserAuth(fn: AuthenticateMcpUserKeyFn): void {
  _authenticateFn = fn;
}

/**
 * 执行 MCP User 密钥鉴权。
 *
 * 从 Authorization 头提取 Bearer token，通过 SHA-256 哈希查找 mcp_api_key 表，
 * 验证 key 有效性与用户状态，返回 Principal。
 *
 * @param authHeader - 完整的 Authorization 头值
 * @returns Principal { type: "apiKey", userId, apiKeyId, plan, relayOnly: false }
 * @throws McpAuthError 无效 token / key 已禁用 / 用户被封禁
 */
export async function authenticateMcpUserKey(
  authHeader: string,
): Promise<Principal> {
  return _authenticateFn(authHeader);
}
