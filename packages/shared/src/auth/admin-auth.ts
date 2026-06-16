import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@repo/database";
import * as schema from "@repo/database/schema";

/**
 * 管理员独立 Better Auth 实例
 *
 * 与用户认证完全隔离：使用独立的 admin_user/admin_session/admin_account/admin_verification 表。
 * Cookie 前缀为 "admin"（cookie 名为 "admin.session_token"），防止与用户侧 cookie 冲突。
 * 仅支持邮箱/密码登录，不开放社交登录。
 *
 * 关键设计：
 * - drizzle adapter 的 schema 映射：key 仍为 Better Auth 内部模型名 (user/session/account/verification)，
 *   value 为实际的 admin_* drizzle table 对象。adapter 内部通过 key 查找对应 table 对象，
 *   然后直接传给 drizzle-orm 的 insert/select/update/delete，drizzle 从 pgTable() 声明解析实际 SQL 表名。
 * - 独立 secret (ADMIN_BETTER_AUTH_SECRET)，回退到 BETTER_AUTH_SECRET。
 * - 独立 baseURL (ADMIN_AUTH_URL)，默认 http://localhost:3001。
 */
export const adminAuth = betterAuth({
  /**
   * 基础 URL 配置
   * 管理员独立入口，与用户侧 BETTER_AUTH_URL 隔离
   */
  baseURL:
    process.env.ADMIN_AUTH_URL || "http://localhost:3001",

  /**
   * 独立密钥
   * 优先使用 ADMIN_BETTER_AUTH_SECRET，回退到共享的 BETTER_AUTH_SECRET
   */
  secret:
    process.env.ADMIN_BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET,

  /**
   * 数据库配置
   * 使用 drizzle adapter，schema 映射到 admin_* 表
   */
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.adminUser,
      session: schema.adminSession,
      account: schema.adminAccount,
      verification: schema.adminVerification,
    },
  }),

  /**
   * 仅支持邮箱/密码登录
   * 管理员不开放社交登录，降低攻击面
   */
  emailAndPassword: {
    enabled: true,
  },

  /**
   * 会话配置
   */
  session: {
    // 会话过期时间: 7 天
    expiresIn: 7 * 24 * 60 * 60,
    // 刷新阈值: 1 天
    updateAge: 24 * 60 * 60,
    // 启用 cookie 缓存，减少数据库查询
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 分钟
    },
  },

  /**
   * 高级配置
   */
  advanced: {
    // cookie 前缀为 "admin"，cookie 名变为 "admin.session_token"
    // 与用户侧 "better-auth.session_token" 完全隔离
    cookiePrefix: "admin",
  },
});

/**
 * 导出类型以供其他模块使用
 */
export type AdminAuth = typeof adminAuth;
