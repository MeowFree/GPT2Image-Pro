import {
  boolean,
  index,
  integer,
  json,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Better Auth 核心表 Schema
 *
 * 这些表是 Better Auth 认证系统所必需的核心表结构
 * 参考: https://www.better-auth.com/docs/concepts/database
 */

// ============================================
// 用户角色枚举
// ============================================

/**
 * 用户角色枚举
 */
export const userRoleEnum = pgEnum("user_role", [
  "user",
  "observer_admin",
  "admin",
  "super_admin",
]);

// ============================================
// 用户表 (User)
// ============================================
/**
 * 用户表 - 存储用户基本信息
 *
 * @field id - 用户唯一标识符
 * @field name - 用户显示名称
 * @field email - 用户邮箱 (唯一)
 * @field emailVerified - 邮箱是否已验证
 * @field image - 用户头像 URL
 * @field role - 用户角色 (user/observer_admin/admin/super_admin)
 * @field banned - 是否被封禁
 * @field bannedReason - 封禁原因
 * @field moderationBlockRiskLevel - 用户默认审核拦截级别
 * @field customerId - 支付提供商客户 ID (Creem)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("user"),
  banned: boolean("banned").notNull().default(false),
  bannedReason: text("banned_reason"),
  moderationBlockRiskLevel: text("moderation_block_risk_level")
    .notNull()
    .default("low"),
  customerId: text("customer_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 管理员操作审计日志 (Admin Audit Log)
// ============================================
/**
 * 管理员操作审计日志 - 记录高风险后台操作
 *
 * @field id - 记录唯一标识符
 * @field adminUserId - 执行操作的管理员用户 ID
 * @field targetUserId - 被操作的目标用户 ID（可为空，用于全局操作）
 * @field action - 操作类型
 * @field reason - 管理员填写的操作原因
 * @field before - 操作前快照
 * @field after - 操作后快照
 * @field metadata - 扩展元数据
 * @field createdAt - 创建时间
 */
export const adminAuditLog = pgTable("admin_audit_log", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  targetUserId: text("target_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  reason: text("reason"),
  before: json("before").$type<Record<string, unknown>>(),
  after: json("after").$type<Record<string, unknown>>(),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 注册邮箱账本 (Registration Identity)
// ============================================
/**
 * 注册邮箱账本 - 永久记录已经注册过的邮箱
 *
 * 即使用户后续删除账号，也保留邮箱占位，防止重复注册领取新用户奖励。
 *
 * @field id - 记录唯一标识符
 * @field email - 规范化邮箱 (小写，唯一)
 * @field userId - 首次注册关联用户 ID (用户硬删后可为空)
 * @field firstRegisteredAt - 首次注册时间
 * @field lastSeenAt - 最近一次确认时间
 * @field deletedAt - 账号删除时间 (可为空)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const registrationIdentity = pgTable("registration_identity", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  firstRegisteredAt: timestamp("first_registered_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 会话表 (Session)
// ============================================
/**
 * 会话表 - 存储用户登录会话
 *
 * @field id - 会话唯一标识符
 * @field expiresAt - 会话过期时间
 * @field token - 会话令牌 (用于验证)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 * @field ipAddress - 登录 IP 地址
 * @field userAgent - 用户代理 (浏览器信息)
 * @field userId - 关联的用户 ID
 */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// ============================================
// 账户表 (Account)
// ============================================
/**
 * 账户表 - 存储 OAuth 提供商关联信息
 *
 * 当用户使用 GitHub、Google 等第三方登录时，
 * 此表存储该提供商的账户信息
 *
 * @field id - 账户唯一标识符
 * @field accountId - 提供商返回的账户 ID
 * @field providerId - 提供商标识符 (如 "github", "google")
 * @field userId - 关联的用户 ID
 * @field accessToken - 访问令牌
 * @field refreshToken - 刷新令牌
 * @field idToken - ID 令牌 (OpenID Connect)
 * @field accessTokenExpiresAt - 访问令牌过期时间
 * @field refreshTokenExpiresAt - 刷新令牌过期时间
 * @field scope - 授权范围
 * @field password - 密码哈希 (用于邮箱密码登录)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 验证表 (Verification)
// ============================================
/**
 * 验证表 - 存储邮箱验证和密码重置令牌
 *
 * @field id - 验证记录唯一标识符
 * @field identifier - 标识符 (通常是邮箱地址)
 * @field value - 验证值/令牌
 * @field expiresAt - 过期时间
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 订阅表 (Subscription)
// ============================================
/**
 * 订阅表 - 存储用户的订阅信息
 *
 * @field id - 订阅记录唯一标识符
 * @field userId - 关联的用户 ID
 * @field subscriptionId - 支付提供商订阅 ID (唯一)
 * @field priceId - 支付提供商价格/产品 ID
 * @field status - 订阅状态 (active, canceled, past_due, etc.)
 * @field currentPeriodStart - 当前计费周期开始时间
 * @field currentPeriodEnd - 当前计费周期结束时间
 * @field cancelAtPeriodEnd - 是否在周期结束时取消
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const subscription = pgTable("subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  subscriptionId: text("subscription_id").notNull().unique(),
  priceId: text("price_id").notNull(),
  status: text("status").notNull().default("incomplete"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 类型导出
// ============================================
/**
 * 从 Schema 推断的类型
 * 用于在应用中保持类型安全
 */
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;

export type RegistrationIdentity = typeof registrationIdentity.$inferSelect;
export type NewRegistrationIdentity = typeof registrationIdentity.$inferInsert;

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;

export type Subscription = typeof subscription.$inferSelect;
export type NewSubscription = typeof subscription.$inferInsert;

// ============================================
// Epay 订单表
// ============================================
/**
 * 易支付订单表 - 本地保存业务元数据，避免把长 param 透传给支付网关。
 */
export const epayOrder = pgTable("epay_order", {
  outTradeNo: text("out_trade_no").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  businessType: text("business_type").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" })
    .notNull(),
  status: text("status").notNull().default("pending"),
  metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EpayOrder = typeof epayOrder.$inferSelect;
export type NewEpayOrder = typeof epayOrder.$inferInsert;

// ============================================
// 积分系统枚举
// ============================================

/**
 * 积分账户状态枚举
 */
export const creditsBalanceStatusEnum = pgEnum("credits_balance_status", [
  "active",
  "frozen",
]);

/**
 * 积分批次状态枚举
 */
export const creditsBatchStatusEnum = pgEnum("credits_batch_status", [
  "active",
  "consumed",
  "expired",
]);

/**
 * 积分批次来源类型枚举
 */
export const creditsBatchSourceEnum = pgEnum("credits_batch_source", [
  "purchase",
  "subscription",
  "bonus",
  "refund",
]);

/**
 * 积分交易类型枚举
 */
export const creditsTransactionTypeEnum = pgEnum("credits_transaction_type", [
  "purchase",
  "consumption",
  "monthly_grant",
  "registration_bonus",
  "admin_grant",
  "expiration",
  "refund",
]);

// ============================================
// 积分余额表 (Credits Balances)
// ============================================
/**
 * 积分余额表 - 存储用户的积分账户信息
 *
 * 采用预计算余额模式，避免每次查询都需要聚合计算
 *
 * @field id - 记录唯一标识符
 * @field userId - 关联的用户 ID（唯一）
 * @field balance - 当前可用积分余额
 * @field totalEarned - 累计获得积分
 * @field totalSpent - 累计消费积分
 * @field status - 账户状态（active/frozen）
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const creditsBalance = pgTable("credits_balance", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: numeric("balance", { precision: 18, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  totalEarned: numeric("total_earned", {
    precision: 18,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  totalSpent: numeric("total_spent", {
    precision: 18,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  status: creditsBalanceStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 积分批次表 (Credits Batches)
// ============================================
/**
 * 积分批次表 - 积分库存管理
 *
 * 每次获得积分都会创建一个批次记录
 * 用于实现 FIFO (先进先出) 过期机制
 *
 * @field id - 批次唯一标识符
 * @field userId - 关联的用户 ID
 * @field amount - 原始积分数量
 * @field remaining - 剩余积分数量
 * @field issuedAt - 发放时间
 * @field expiresAt - 过期时间
 * @field status - 批次状态（active/consumed/expired）
 * @field sourceType - 来源类型（purchase/subscription/bonus/refund）
 * @field sourceRef - 来源引用（如订单ID、订阅ID等）
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const creditsBatch = pgTable("credits_batch", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 18, scale: 2, mode: "number" })
    .notNull(),
  remaining: numeric("remaining", { precision: 18, scale: 2, mode: "number" })
    .notNull(),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  status: creditsBatchStatusEnum("status").notNull().default("active"),
  sourceType: creditsBatchSourceEnum("source_type").notNull(),
  sourceRef: text("source_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 积分交易表 (Credits Transactions)
// ============================================
/**
 * 积分交易表 - 双重记账账本
 *
 * 记录所有积分变动，采用借贷记账法
 * 每笔交易都有明确的借方(debit)和贷方(credit)账户
 *
 * @field id - 交易唯一标识符
 * @field userId - 关联的用户 ID
 * @field type - 交易类型
 * @field amount - 交易积分数量（始终为正数）
 * @field debitAccount - 借方账户（资金来源）
 * @field creditAccount - 贷方账户（资金去向）
 * @field description - 交易描述
 * @field metadata - 扩展元数据（JSON）
 * @field createdAt - 创建时间
 */
export const creditsTransaction = pgTable("credits_transaction", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: creditsTransactionTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2, mode: "number" })
    .notNull(),
  debitAccount: text("debit_account").notNull(),
  creditAccount: text("credit_account").notNull(),
  description: text("description"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 系统设置表 (System Settings)
// ============================================
/**
 * 系统设置表 - 存储管理员可配置的运行时配置与密钥
 *
 * @field key - 配置键名
 * @field value - 配置值，密钥也存储在这里但不会在管理界面回显
 * @field isSecret - 是否为密钥类配置
 * @field updatedBy - 最近更新的管理员
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const systemSetting = pgTable("system_setting", {
  key: text("key").primaryKey(),
  value: json("value").$type<unknown>().notNull(),
  isSecret: boolean("is_secret").notNull().default(false),
  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// Chat 纯文字连续使用状态
// ============================================
/**
 * Chat 纯文字连续使用状态 - 用于限制连续多次对话但不出图的滥用
 */
export const chatNoImageState = pgTable("chat_no_image_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  consecutiveCount: integer("consecutive_count").notNull().default(0),
  lastGenerationId: text("last_generation_id"),
  lastPenaltyAt: timestamp("last_penalty_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SystemSetting = typeof systemSetting.$inferSelect;
export type NewSystemSetting = typeof systemSetting.$inferInsert;

export type ChatNoImageState = typeof chatNoImageState.$inferSelect;
export type NewChatNoImageState = typeof chatNoImageState.$inferInsert;

// ============================================
// 积分系统类型导出
// ============================================

export type CreditsBalance = typeof creditsBalance.$inferSelect;
export type NewCreditsBalance = typeof creditsBalance.$inferInsert;

export type CreditsBatch = typeof creditsBatch.$inferSelect;
export type NewCreditsBatch = typeof creditsBatch.$inferInsert;

export type CreditsTransaction = typeof creditsTransaction.$inferSelect;
export type NewCreditsTransaction = typeof creditsTransaction.$inferInsert;

/** 积分账户状态类型 */
export type CreditsBalanceStatus =
  (typeof creditsBalanceStatusEnum.enumValues)[number];

/** 积分批次状态类型 */
export type CreditsBatchStatus =
  (typeof creditsBatchStatusEnum.enumValues)[number];

/** 积分批次来源类型 */
export type CreditsBatchSource =
  (typeof creditsBatchSourceEnum.enumValues)[number];

/** 积分交易类型 */
export type CreditsTransactionType =
  (typeof creditsTransactionTypeEnum.enumValues)[number];

// ============================================
// Newsletter 订阅表
// ============================================
/**
 * Newsletter 订阅者表 - 存储邮件订阅信息
 *
 * @field id - 记录唯一标识符
 * @field email - 订阅者邮箱 (唯一)
 * @field isSubscribed - 是否订阅中 (用于取消订阅而不删除记录)
 * @field subscribedAt - 订阅时间
 * @field unsubscribedAt - 取消订阅时间 (可为空)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const newsletterSubscriber = pgTable("newsletter_subscriber", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  isSubscribed: boolean("is_subscribed").notNull().default(true),
  subscribedAt: timestamp("subscribed_at").notNull().defaultNow(),
  unsubscribedAt: timestamp("unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// Newsletter 类型导出
// ============================================

export type NewsletterSubscriber = typeof newsletterSubscriber.$inferSelect;
export type NewNewsletterSubscriber = typeof newsletterSubscriber.$inferInsert;

// ============================================
// 公告系统 (Announcements)
// ============================================

/**
 * 公告表 - 存储系统公告、维护通知和活动说明
 *
 * @field id - 公告唯一标识符
 * @field title - 公告标题
 * @field content - 公告正文，按纯文本展示
 * @field severity - 公告等级 (info/success/warning/critical)
 * @field isPublished - 是否发布
 * @field isPinned - 是否置顶
 * @field priority - 排序优先级，数字越大越靠前
 * @field publishedAt - 生效发布时间，可为空
 * @field expiresAt - 过期时间，可为空
 * @field createdByUserId - 创建管理员
 * @field updatedByUserId - 最近更新管理员
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const announcement = pgTable("announcement", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  severity: text("severity").notNull().default("info"),
  isPublished: boolean("is_published").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),
  priority: integer("priority").notNull().default(0),
  publishedAt: timestamp("published_at"),
  expiresAt: timestamp("expires_at"),
  createdByUserId: text("created_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 公告已读表 - 记录用户已读公告
 */
export const announcementRead = pgTable(
  "announcement_read",
  {
    id: text("id").primaryKey(),
    announcementId: text("announcement_id")
      .notNull()
      .references(() => announcement.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at").notNull().defaultNow(),
  },
  (table) => ({
    announcementUserUnique: uniqueIndex(
      "announcement_read_user_announcement_unique"
    ).on(table.userId, table.announcementId),
  })
);

export type Announcement = typeof announcement.$inferSelect;
export type NewAnnouncement = typeof announcement.$inferInsert;
export type AnnouncementRead = typeof announcementRead.$inferSelect;
export type NewAnnouncementRead = typeof announcementRead.$inferInsert;

// ============================================
// 工单系统枚举
// ============================================

/**
 * 工单类别枚举
 */
export const ticketCategoryEnum = pgEnum("ticket_category", [
  "billing",
  "technical",
  "bug",
  "feature",
  "other",
]);

/**
 * 工单优先级枚举
 */
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
]);

/**
 * 工单状态枚举
 */
export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

// ============================================
// 工单表 (Tickets)
// ============================================
/**
 * 工单表 - 存储用户支持工单
 *
 * @field id - 工单唯一标识符
 * @field userId - 创建工单的用户 ID
 * @field subject - 工单主题
 * @field category - 工单类别 (billing/technical/bug/feature/other)
 * @field priority - 优先级 (low/medium/high)
 * @field status - 状态 (open/in_progress/resolved/closed)
 * @field userLastSeenAt - 用户最近查看工单详情时间
 * @field lastAdminActivityAt - 最近一次管理员回复或状态更新时间
 * @field adminLastSeenAt - 管理员最近查看工单详情时间
 * @field lastUserActivityAt - 最近一次用户新建或回复时间
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const ticket = pgTable("ticket", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  category: ticketCategoryEnum("category").notNull().default("other"),
  priority: ticketPriorityEnum("priority").notNull().default("medium"),
  status: ticketStatusEnum("status").notNull().default("open"),
  userLastSeenAt: timestamp("user_last_seen_at").notNull().defaultNow(),
  lastAdminActivityAt: timestamp("last_admin_activity_at"),
  adminLastSeenAt: timestamp("admin_last_seen_at"),
  lastUserActivityAt: timestamp("last_user_activity_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 工单消息表 (Ticket Messages)
// ============================================
/**
 * 工单消息表 - 存储工单对话记录
 *
 * @field id - 消息唯一标识符
 * @field ticketId - 关联的工单 ID
 * @field userId - 发送者用户 ID
 * @field content - 消息内容
 * @field isAdminResponse - 是否为管理员回复 (用于 UI 样式区分)
 * @field createdAt - 创建时间
 */
export const ticketMessage = pgTable("ticket_message", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => ticket.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  isAdminResponse: boolean("is_admin_response").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// User API Configuration
// ============================================
export const userApiConfig = pgTable("user_api_config", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  model: text("model"),
  useStream: boolean("use_stream").notNull().default(false),
  chatCompletionsUpstreamMode: text("chat_completions_upstream_mode")
    .notNull()
    .default("responses"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserApiConfig = typeof userApiConfig.$inferSelect;
export type NewUserApiConfig = typeof userApiConfig.$inferInsert;

// ============================================
// Image Backend Pool
// ============================================
export const imageBackendGroup = pgTable("image_backend_group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  isUserSelectable: boolean("is_user_selectable").notNull().default(true),
  contentSafetyEnabled: boolean("content_safety_enabled"),
  priority: integer("priority").notNull().default(50),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const imageBackendAccount = pgTable(
  "image_backend_account",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").references(() => imageBackendGroup.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    email: text("email"),
    credentialHash: text("credential_hash").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    implementationMode: text("interface_mode").notNull().default("web"),
    model: text("model"),
    contentSafetyEnabled: boolean("content_safety_enabled").notNull().default(true),
    isEnabled: boolean("is_enabled").notNull().default(true),
    priority: integer("priority").notNull().default(50),
    concurrency: integer("concurrency").notNull().default(1),
    successCount: integer("success_count").notNull().default(0),
    failCount: integer("fail_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at"),
    lastAcquiredAt: timestamp("last_acquired_at"),
    cooldownUntil: timestamp("cooldown_until"),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("image_backend_account_interface_credential_hash_unique").on(
      table.implementationMode,
      table.credentialHash
    ),
  ]
);

export const imageBackendAccountGroup = pgTable(
  "image_backend_account_group",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => imageBackendAccount.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => imageBackendGroup.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("image_backend_account_group_account_group_unique").on(
      table.accountId,
      table.groupId
    ),
    index("image_backend_account_group_group_idx").on(table.groupId),
  ]
);

export const imageBackendApi = pgTable("image_backend_api", {
  id: text("id").primaryKey(),
  groupId: text("group_id").references(() => imageBackendGroup.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  model: text("model"),
  interfaceMode: text("interface_mode").notNull().default("images"),
  useStream: boolean("use_stream").notNull().default(false),
  chatCompletionsUpstreamMode: text("chat_completions_upstream_mode")
    .notNull()
    .default("responses"),
  contentSafetyEnabled: boolean("content_safety_enabled").notNull().default(true),
  isEnabled: boolean("is_enabled").notNull().default(true),
  priority: integer("priority").notNull().default(50),
  successCount: integer("success_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  lastUsedAt: timestamp("last_used_at"),
  lastAcquiredAt: timestamp("last_acquired_at"),
  cooldownUntil: timestamp("cooldown_until"),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const userImageBackendPreference = pgTable(
  "user_image_backend_preference",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    groupId: text("group_id").references(() => imageBackendGroup.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  }
);

export type ImageBackendGroup = typeof imageBackendGroup.$inferSelect;
export type NewImageBackendGroup = typeof imageBackendGroup.$inferInsert;
export type ImageBackendAccount = typeof imageBackendAccount.$inferSelect;
export type NewImageBackendAccount = typeof imageBackendAccount.$inferInsert;
export type ImageBackendAccountGroup =
  typeof imageBackendAccountGroup.$inferSelect;
export type NewImageBackendAccountGroup =
  typeof imageBackendAccountGroup.$inferInsert;
export type ImageBackendApi = typeof imageBackendApi.$inferSelect;
export type NewImageBackendApi = typeof imageBackendApi.$inferInsert;
export type UserImageBackendPreference =
  typeof userImageBackendPreference.$inferSelect;
export type NewUserImageBackendPreference =
  typeof userImageBackendPreference.$inferInsert;

// ============================================
// External API Keys
// ============================================
export const externalApiKey = pgTable("external_api_key", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Default API key"),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  lastFour: text("last_four").notNull(),
  moderationBlockRiskLevel: text("moderation_block_risk_level")
    .notNull()
    .default("low"),
  generationGroupId: text("generation_group_id").references(
    () => imageBackendGroup.id,
    { onDelete: "set null" }
  ),
  creditLimit: numeric("credit_limit", {
    precision: 18,
    scale: 2,
    mode: "number",
  }),
  creditsUsed: numeric("credits_used", {
    precision: 18,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  lastUsedAt: timestamp("last_used_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ExternalApiKey = typeof externalApiKey.$inferSelect;
export type NewExternalApiKey = typeof externalApiKey.$inferInsert;

// ============================================
// Image Generation
// ============================================

export const generationStatusEnum = pgEnum("generation_status", [
  "pending",
  "completed",
  "failed",
]);

export const generation = pgTable("generation", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  revisedPrompt: text("revised_prompt"),
  model: text("model").notNull(),
  size: text("size").notNull().default("1024x1024"),
  status: generationStatusEnum("status").notNull().default("pending"),
  storageKey: text("storage_key"),
  storageBucket: text("storage_bucket").default("generations"),
  fileSize: integer("file_size"),
  creditsConsumed: numeric("credits_consumed", {
    precision: 18,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  error: text("error"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type Generation = typeof generation.$inferSelect;
export type NewGeneration = typeof generation.$inferInsert;
export type GenerationStatus = (typeof generationStatusEnum.enumValues)[number];

// ============================================
// 工单系统类型导出
// ============================================

export type Ticket = typeof ticket.$inferSelect;
export type NewTicket = typeof ticket.$inferInsert;

export type TicketMessage = typeof ticketMessage.$inferSelect;
export type NewTicketMessage = typeof ticketMessage.$inferInsert;

/** 用户角色类型 */
export type UserRole = (typeof userRoleEnum.enumValues)[number];

/** 工单类别类型 */
export type TicketCategory = (typeof ticketCategoryEnum.enumValues)[number];

/** 工单优先级类型 */
export type TicketPriority = (typeof ticketPriorityEnum.enumValues)[number];

/** 工单状态类型 */
export type TicketStatus = (typeof ticketStatusEnum.enumValues)[number];
