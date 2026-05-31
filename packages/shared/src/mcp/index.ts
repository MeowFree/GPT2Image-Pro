/**
 * MCP 模块桶导出
 *
 * 职责：聚合 MCP User 相关模块的公共 API。
 * 分为配置、鉴权、工具工厂三个子模块。
 * Key 管理操作单独导出（含 DB 依赖）。
 */
export { isMcpUserEnabled, getMcpUserRateLimitPerMin } from "./user-config";
export {
  authenticateMcpUserKey,
  bindMcpUserAuth,
  McpAuthError,
  type AuthenticateMcpUserKeyFn,
} from "./user-auth";
export { buildUserMcpTools, type McpToolDescriptor } from "./user-tool-factory";
