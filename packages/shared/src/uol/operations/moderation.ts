/**
 * UOL Operations - Moderation Domain
 *
 * 职责：注册内容审核领域的所有操作到 UOL 注册表。
 * 包含核心审核编排、提供者查询、启用状态查询、代理审核端点。
 *
 * 使用方：UOL invoke 网关、MCP 适配器、内置 Agent
 * 关键依赖：../registry (defineOperation)、zod (schema)
 *
 * 注意：execute 均为 stub，待实际接线时替换为真实实现。
 * 不依赖 @repo/database 或 apps/web 的任何导入。
 */
import { z } from "zod";

import { defineOperation } from "../registry";

// -- 通用子 schema --

/**
 * 审核图片输入 schema - 对应 ModerationImageInput 接口。
 * data 在 proxy 场景为 base64 字符串，url 为公开可访问地址。
 */
const moderationImageInputSchema = z.object({
  data: z.string().optional(),
  type: z.string(),
  name: z.string().optional(),
  url: z.string().optional(),
});

/**
 * 审核决策结果 schema - 对应 ModerationResult 接口。
 * decision: allow/block/skipped/error 四种状态。
 */
const moderationResultSchema = z.object({
  decision: z.enum(["allow", "block", "skipped", "error"]),
  provider: z.string().optional(),
  reason: z.string().optional(),
  details: z.unknown().optional(),
});

// =============================================================================
// 1. moderation.moderateContent
//    核心审核编排器：接收文本/图片输入，协调多提供者执行审核并返回最终决策。
//    系统内部调用，由图像生成管线触发。
// =============================================================================

export const moderateContent = defineOperation({
  name: "moderation.moderateContent",
  domain: "moderation",
  title: "Moderate Content",
  description:
    "核心内容审核编排器。接收文本与可选图片输入，依次尝试代理、" +
    "Aliyun、OpenAI 提供者执行审核，返回 allow/block/skipped/error 决策。" +
    "由图像生成管线在生成前调用，fail-closed 策略。",
  input: z.object({
    prompt: z.string(),
    images: z.array(moderationImageInputSchema).optional(),
    mode: z.enum(["text", "image"]).optional(),
    userId: z.string().optional(),
    userPlan: z.string().optional(),
    userModerationBlockRiskLevel: z.string().optional(),
    generationId: z.string().optional(),
    skipProxy: z.boolean().optional(),
  }),
  output: moderationResultSchema,
  access: { kind: "system" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  processLocalState: false,
  execute: async () => {
    throw new Error("Not yet wired: moderation.moderateContent");
  },
});

// =============================================================================
// 2. moderation.getProviders
//    获取当前已配置且可用的审核提供者列表（aliyun / openai）。
//    系统内部只读查询。
// =============================================================================

export const getProviders = defineOperation({
  name: "moderation.getProviders",
  domain: "moderation",
  title: "Get Configured Moderation Providers",
  description:
    "返回当前环境中已配置且凭据有效的内容审核提供者列表。" +
    "受 CONTENT_MODERATION_ENABLED 与 CONTENT_MODERATION_PROVIDER 运行时设置控制。" +
    "系统内部使用，用于健康检查与管理面板展示。",
  input: z.object({}),
  output: z.object({
    providers: z.array(z.enum(["aliyun", "openai"])),
  }),
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: false,
  execute: async () => {
    throw new Error("Not yet wired: moderation.getProviders");
  },
});

// =============================================================================
// 3. moderation.isEnabled
//    查询内容审核功能是否全局启用。公开只读接口。
// =============================================================================

export const isEnabled = defineOperation({
  name: "moderation.isEnabled",
  domain: "moderation",
  title: "Is Content Moderation Enabled",
  description:
    "返回当前内容审核功能是否全局启用（基于 CONTENT_MODERATION_ENABLED 运行时设置）。" +
    "公开接口，不需要身份验证。用于前端 UI 条件展示与 Agent 决策。",
  input: z.object({}),
  output: z.object({
    enabled: z.boolean(),
  }),
  access: { kind: "public" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: false,
  execute: async () => {
    throw new Error("Not yet wired: moderation.isEnabled");
  },
});

// =============================================================================
// 4. moderation.proxyModerate
//    POST /moderate 端点 - 接受 proxySecret 鉴权的审核代理入站请求。
//    由远程实例通过 CONTENT_MODERATION_PROXY_URL 回调调用，
//    携带 PROXY_SECRET 或 GATEWAY_SECRET 鉴权。
// =============================================================================

export const proxyModerate = defineOperation({
  name: "moderation.proxyModerate",
  domain: "moderation",
  title: "Proxy Moderate Content",
  description:
    "审核代理入站端点（对应 POST /moderate）。接受携带 proxySecret 鉴权的外部请求，" +
    "在本地执行实际审核逻辑（skipProxy=true 避免循环调用）并返回结果。" +
    "用于多实例部署中的审核能力中心化。",
  input: z.object({
    prompt: z.string(),
    images: z.array(moderationImageInputSchema).optional(),
    mode: z.enum(["text", "image"]).optional(),
    userId: z.string().optional(),
    userPlan: z.string().optional(),
    userModerationBlockRiskLevel: z.string().optional(),
    generationId: z.string().optional(),
  }),
  output: moderationResultSchema,
  access: { kind: "proxySecret" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  processLocalState: false,
  execute: async () => {
    throw new Error("Not yet wired: moderation.proxyModerate");
  },
});
