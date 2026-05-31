/**
 * UOL Operations - user-auth 领域
 *
 * 职责：注册用户与认证相关的所有操作定义（用户管理、会话、注册验证、系统引导）。
 * 使用方：invoke 网关、MCP 适配器、站内 agent 通过 registry 查询并执行。
 * 关键依赖：../registry（defineOperation）、zod（schema 校验）
 *
 * 注意：所有 execute 函数为 stub，待后续对接实际 service 层。
 */
import { z } from "zod";

import { defineOperation } from "../registry";

// ---------------------------------------------------------------------------
// 1. user.list - 列出所有用户（管理员）
// ---------------------------------------------------------------------------
export const listUsers = defineOperation({
  name: "user.list",
  domain: "user-auth",
  title: "List Users",
  description:
    "列出系统中的用户列表，支持分页与过滤。仅管理员可调用。",
  input: z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    role: z.string().optional(),
  }),
  output: z.object({
    users: z.array(z.record(z.string(), z.unknown())),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: user.list");
  },
});

// ---------------------------------------------------------------------------
// 2. user.getDetail - 获取用户详情（管理员）
// ---------------------------------------------------------------------------
export const getUserDetail = defineOperation({
  name: "user.getDetail",
  domain: "user-auth",
  title: "Get User Detail",
  description:
    "获取指定用户的详细信息（含角色、积分、套餐等）。仅管理员可调用。",
  input: z.object({
    userId: z.string().min(1),
  }),
  output: z.record(z.string(), z.unknown()),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: user.getDetail");
  },
});

// ---------------------------------------------------------------------------
// 3. user.updateRole - 更新用户角色（超级管理员）
// ---------------------------------------------------------------------------
export const updateUserRole = defineOperation({
  name: "user.updateRole",
  domain: "user-auth",
  title: "Update User Role",
  description:
    "变更指定用户的角色。仅超级管理员可调用。破坏性操作需二次确认。",
  input: z.object({
    userId: z.string().min(1),
    role: z.enum(["user", "admin", "super_admin"]),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "superAdmin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: user.updateRole");
  },
});

// ---------------------------------------------------------------------------
// 4. user.ban - 封禁/解封用户（管理员）
// ---------------------------------------------------------------------------
export const banUser = defineOperation({
  name: "user.ban",
  domain: "user-auth",
  title: "Ban User",
  description:
    "封禁或解封指定用户。封禁后用户无法登录或使用服务。仅管理员可调用。",
  input: z.object({
    userId: z.string().min(1),
    banned: z.boolean(),
    reason: z.string().optional(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: user.ban");
  },
});

// ---------------------------------------------------------------------------
// 5. user.setCreditsStatus - 设置用户积分状态（管理员）
// ---------------------------------------------------------------------------
export const setUserCreditsStatus = defineOperation({
  name: "user.setCreditsStatus",
  domain: "user-auth",
  title: "Set User Credits Status",
  description:
    "启用或禁用指定用户的积分功能。仅管理员可调用。",
  input: z.object({
    userId: z.string().min(1),
    creditsEnabled: z.boolean(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: user.setCreditsStatus");
  },
});

// ---------------------------------------------------------------------------
// 6. user.setExternalApiKeyStatus - 设置用户外部 API Key 状态（管理员）
// ---------------------------------------------------------------------------
export const setExternalApiKeyStatus = defineOperation({
  name: "user.setExternalApiKeyStatus",
  domain: "user-auth",
  title: "Set External API Key Status",
  description:
    "启用或禁用指定用户的外部 API Key 功能。仅管理员可调用。",
  input: z.object({
    userId: z.string().min(1),
    externalApiKeyEnabled: z.boolean(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: user.setExternalApiKeyStatus");
  },
});

// ---------------------------------------------------------------------------
// 7. user.create - 创建用户（超级管理员）
// ---------------------------------------------------------------------------
export const createUser = defineOperation({
  name: "user.create",
  domain: "user-auth",
  title: "Create User",
  description:
    "手动创建新用户（含邮箱、密码、角色）。仅超级管理员可调用。",
  input: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(1),
    role: z.enum(["user", "admin", "super_admin"]).default("user"),
  }),
  output: z.object({
    userId: z.string(),
    success: z.boolean(),
  }),
  access: { kind: "superAdmin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: user.create");
  },
});

// ---------------------------------------------------------------------------
// 8. user.updateProfile - 更新用户资料（超级管理员）
// ---------------------------------------------------------------------------
export const updateUserProfile = defineOperation({
  name: "user.updateProfile",
  domain: "user-auth",
  title: "Update User Profile",
  description:
    "更新指定用户的资料信息（名称、头像等）。仅超级管理员可调用。",
  input: z.object({
    userId: z.string().min(1),
    name: z.string().min(1).optional(),
    image: z.string().url().optional(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "superAdmin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: user.updateProfile");
  },
});

// ---------------------------------------------------------------------------
// 9. user.setPassword - 设置用户密码（超级管理员）
// ---------------------------------------------------------------------------
export const setUserPassword = defineOperation({
  name: "user.setPassword",
  domain: "user-auth",
  title: "Set User Password",
  description:
    "重置指定用户的密码。仅超级管理员可调用。破坏性操作。",
  input: z.object({
    userId: z.string().min(1),
    newPassword: z.string().min(6),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "superAdmin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: user.setPassword");
  },
});

// ---------------------------------------------------------------------------
// 10. user.setUserPlan - 设置用户套餐（超级管理员）
// ---------------------------------------------------------------------------
export const setUserPlan = defineOperation({
  name: "user.setUserPlan",
  domain: "user-auth",
  title: "Set User Plan",
  description:
    "手动设置指定用户的订阅套餐。仅超级管理员可调用。",
  input: z.object({
    userId: z.string().min(1),
    plan: z.string().min(1),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "superAdmin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit", "billing"],
  execute: async () => {
    throw new Error("Not yet wired: user.setUserPlan");
  },
});

// ---------------------------------------------------------------------------
// 11. user.getCurrentSession - 获取当前会话（公开，通过 cookie 鉴权）
// ---------------------------------------------------------------------------
export const getCurrentSession = defineOperation({
  name: "user.getCurrentSession",
  domain: "user-auth",
  title: "Get Current Session",
  description:
    "获取当前登录用户的会话信息。公开接口，通过 cookie 识别身份。",
  input: z.object({}),
  output: z.object({
    user: z.record(z.string(), z.unknown()).nullable(),
    session: z.record(z.string(), z.unknown()).nullable(),
  }),
  access: { kind: "public" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: user.getCurrentSession");
  },
});

// ---------------------------------------------------------------------------
// 12. user.sendVerificationCode - 发送注册验证码（公开）
// ---------------------------------------------------------------------------
export const sendRegistrationVerificationCode = defineOperation({
  name: "user.sendVerificationCode",
  domain: "user-auth",
  title: "Send Registration Verification Code",
  description:
    "向指定邮箱发送注册验证码。公开接口，受频率限制。",
  input: z.object({
    email: z.string().email(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "public" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["email"],
  execute: async () => {
    throw new Error("Not yet wired: user.sendVerificationCode");
  },
});

// ---------------------------------------------------------------------------
// 13. user.verifyCode - 验证注册验证码（公开）
// ---------------------------------------------------------------------------
export const verifyRegistrationCode = defineOperation({
  name: "user.verifyCode",
  domain: "user-auth",
  title: "Verify Registration Code",
  description:
    "验证注册验证码是否正确。公开接口。",
  input: z.object({
    email: z.string().email(),
    code: z.string().min(1),
  }),
  output: z.object({
    valid: z.boolean(),
  }),
  access: { kind: "public" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: user.verifyCode");
  },
});

// ---------------------------------------------------------------------------
// 14. user.bootstrap - 引导超级管理员（仅系统内部，永远不可外部暴露）
// ---------------------------------------------------------------------------
export const bootstrapSelfUseSuperAdmin = defineOperation({
  name: "user.bootstrap",
  domain: "user-auth",
  title: "Bootstrap Self-Use Super Admin",
  description:
    "系统初始化时创建首个超级管理员。仅系统内部调用，永远不可通过任何外部传输暴露。",
  input: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(1),
  }),
  output: z.object({
    userId: z.string(),
    success: z.boolean(),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: false,
  idempotency: {
    kind: "required",
    keyField: "email",
    scope: "global",
  },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: user.bootstrap");
  },
});
