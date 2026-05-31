/**
 * MCP User 配置模块
 *
 * 职责：提供 MCP 用户端功能的开关与配置读取。
 * MCP User 默认关闭，需显式设置 MCP_USER_ENABLED=true 启用。
 *
 * 使用方：apps/web MCP user route handler（鉴权前置检查）
 * 关键依赖：无外部依赖（纯环境变量读取）
 */

/**
 * 检查 MCP User 功能是否启用。
 *
 * 读取环境变量 MCP_USER_ENABLED，仅当值为 "true"（不区分大小写）时返回 true。
 * 未配置或其他值均视为关闭。
 *
 * @returns 是否启用 MCP User 端点
 */
export function isMcpUserEnabled(): boolean {
  const value = process.env.MCP_USER_ENABLED ?? "";
  return value.toLowerCase() === "true";
}

/**
 * 获取 MCP User 端每分钟速率限制（per-key）。
 *
 * 读取环境变量 MCP_USER_RATE_LIMIT_PER_MIN，未配置或解析失败时回退默认值 30。
 * 值域：正整数，最小 1。
 *
 * @returns 每分钟最大请求数
 */
export function getMcpUserRateLimitPerMin(): number {
  const raw = process.env.MCP_USER_RATE_LIMIT_PER_MIN;
  if (!raw) return 30;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 30;
  return parsed;
}
