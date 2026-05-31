/**
 * MCP User Key 管理操作
 *
 * 职责：提供终端用户管理自己的 MCP 密钥的 CRUD 操作：
 * - 创建（generate + hash + store，明文仅返回一次）
 * - 列表（脱敏展示，不含 hash/明文）
 * - 撤销（set isActive=false, revokedAt=now）
 * - 删除（仅已撤销的 key 可删除）
 *
 * 使用方：Server Action / MCP 设置页面
 * 关键依赖：@repo/database（db、mcpApiKey schema）、nanoid、crypto
 *
 * 安全约束：
 * - 明文 key 仅在创建时返回一次，后续不可恢复
 * - 所有操作校验 userId 归属，防止越权
 */
import { createHash, randomBytes } from "node:crypto";

import { db } from "@repo/database";
import { mcpApiKey } from "@repo/database/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

/** MCP key 前缀 - 用于快速区分 key 类型 */
const MCP_KEY_PREFIX = "mcp_";

/**
 * 生成随机 MCP API key 明文。
 * 格式：mcp_ + 48 字节随机 hex = "mcp_" + 96 字符
 */
function generateMcpKeyPlaintext(): string {
  return `${MCP_KEY_PREFIX}${randomBytes(48).toString("hex")}`;
}

/**
 * 对 key 明文进行 SHA-256 哈希（与 external API key 同算法）。
 */
function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * 创建新的 MCP 用户密钥。
 *
 * 生成随机密钥 -> SHA-256 哈希 -> 存入数据库。
 * 明文仅此次返回，不可恢复。
 *
 * @param userId - 所属用户 ID
 * @param name - 用户自定义名称（可选，默认 "Default MCP key"）
 * @returns 包含明文密钥的创建结果（明文仅此次可见）
 */
export async function createMcpKey(
  userId: string,
  name?: string,
): Promise<{
  id: string;
  key: string;
  name: string;
  keyPrefix: string;
  lastFour: string;
  createdAt: Date;
}> {
  const id = nanoid();
  const plaintext = generateMcpKeyPlaintext();
  const keyHash = hashKey(plaintext);
  const lastFour = plaintext.slice(-4);
  const keyName = name || "Default MCP key";

  await db.insert(mcpApiKey).values({
    id,
    userId,
    name: keyName,
    keyPrefix: MCP_KEY_PREFIX,
    keyHash,
    lastFour,
    isActive: true,
  });

  return {
    id,
    key: plaintext,
    name: keyName,
    keyPrefix: MCP_KEY_PREFIX,
    lastFour,
    createdAt: new Date(),
  };
}

/**
 * 列出用户的 MCP 密钥（脱敏，不含 hash/明文）。
 *
 * @param userId - 用户 ID
 * @returns 脱敏的 key 列表
 */
export async function listMcpKeys(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    keyPrefix: string;
    lastFour: string;
    isActive: boolean;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }>
> {
  const keys = await db
    .select({
      id: mcpApiKey.id,
      name: mcpApiKey.name,
      keyPrefix: mcpApiKey.keyPrefix,
      lastFour: mcpApiKey.lastFour,
      isActive: mcpApiKey.isActive,
      lastUsedAt: mcpApiKey.lastUsedAt,
      revokedAt: mcpApiKey.revokedAt,
      createdAt: mcpApiKey.createdAt,
    })
    .from(mcpApiKey)
    .where(eq(mcpApiKey.userId, userId))
    .orderBy(mcpApiKey.createdAt);

  return keys;
}

/**
 * 撤销 MCP 密钥（不可逆）。
 *
 * 将 isActive 设为 false、revokedAt 设为当前时间。
 * 已撤销的 key 不可恢复，仅可进一步删除。
 *
 * @param userId - 用户 ID（归属校验）
 * @param keyId - 要撤销的 key ID
 * @returns 是否成功（key 不存在或非该用户所有返回 false）
 */
export async function revokeMcpKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const result = await db
    .update(mcpApiKey)
    .set({
      isActive: false,
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mcpApiKey.id, keyId),
        eq(mcpApiKey.userId, userId),
        eq(mcpApiKey.isActive, true),
      ),
    );

  // drizzle pg driver: result.rowCount 表示受影响行数
  const rowCount = (result as unknown as { rowCount: number }).rowCount;
  return rowCount > 0;
}

/**
 * 删除 MCP 密钥（仅允许删除已撤销的 key）。
 *
 * 安全约束：仅 isActive=false 的 key 可被物理删除。
 * 防止误删正在使用的 key。
 *
 * @param userId - 用户 ID（归属校验）
 * @param keyId - 要删除的 key ID
 * @returns 是否成功（key 不存在、非该用户所有、或仍 active 均返回 false）
 */
export async function deleteMcpKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const result = await db
    .delete(mcpApiKey)
    .where(
      and(
        eq(mcpApiKey.id, keyId),
        eq(mcpApiKey.userId, userId),
        eq(mcpApiKey.isActive, false),
      ),
    );

  const rowCount = (result as unknown as { rowCount: number }).rowCount;
  return rowCount > 0;
}
