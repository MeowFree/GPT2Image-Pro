/**
 * UOL Operations - External API 领域
 *
 * 职责：注册所有外部 API (v1) 相关操作，包括：
 * - 图像生成/编辑/Agent 图像端点
 * - Chat completions / Responses 端点
 * - 积分查询、任务查询、模型列表（只读端点）
 * - API Key 管理（CRUD、配额、审核、中转、分组）
 * - 管理员 Key 状态设置
 *
 * 使用方：UOL invoke 网关、MCP 适配器、内置 Agent
 * 关键依赖：../registry（defineOperation）、zod（schema 校验）
 *
 * 注意：所有 execute 函数当前为存根实现，待后续接入实际业务逻辑。
 */
import { z } from "zod";

import { defineOperation } from "../registry";

// ---------------------------------------------------------------------------
// 1. externalApi.generateImages - /v1/images/generations (apiKey)
// ---------------------------------------------------------------------------
export const generateImages = defineOperation({
  name: "externalApi.generateImages",
  domain: "external-api",
  title: "Generate Images",
  description:
    "通过 /v1/images/generations 端点生成图像。需要有效 API Key。",
  input: z.object({
    model: z.string().describe("图像生成模型标识"),
    prompt: z.string().describe("图像生成提示词"),
    n: z.number().int().positive().optional().describe("生成数量"),
    size: z.string().optional().describe("图像尺寸，如 1024x1024"),
    quality: z.string().optional().describe("图像质量"),
    style: z.string().optional().describe("图像风格"),
    response_format: z
      .enum(["url", "b64_json"])
      .optional()
      .describe("响应格式"),
  }),
  output: z.object({
    created: z.number().describe("创建时间戳"),
    data: z.array(
      z.object({
        url: z.string().optional(),
        b64_json: z.string().optional(),
        revised_prompt: z.string().optional(),
      }),
    ),
    taskId: z.string().optional().describe("异步任务 ID"),
  }),
  access: { kind: "apiKey" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["billing", "external-call", "storage"],
  async execute() {
    throw new Error("Not yet wired: externalApi.generateImages");
  },
});

// ---------------------------------------------------------------------------
// 2. externalApi.editImages - /v1/images/edits (apiKey)
// ---------------------------------------------------------------------------
export const editImages = defineOperation({
  name: "externalApi.editImages",
  domain: "external-api",
  title: "Edit Images",
  description:
    "通过 /v1/images/edits 端点编辑图像。需要有效 API Key。",
  input: z.object({
    model: z.string().describe("图像编辑模型标识"),
    prompt: z.string().describe("编辑指令"),
    image: z.string().describe("原始图像（base64 或 URL）"),
    mask: z.string().optional().describe("遮罩图像（base64 或 URL）"),
    n: z.number().int().positive().optional().describe("生成数量"),
    size: z.string().optional().describe("输出尺寸"),
    response_format: z
      .enum(["url", "b64_json"])
      .optional()
      .describe("响应格式"),
  }),
  output: z.object({
    created: z.number().describe("创建时间戳"),
    data: z.array(
      z.object({
        url: z.string().optional(),
        b64_json: z.string().optional(),
        revised_prompt: z.string().optional(),
      }),
    ),
    taskId: z.string().optional().describe("异步任务 ID"),
  }),
  access: { kind: "apiKey" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["billing", "external-call", "storage"],
  async execute() {
    throw new Error("Not yet wired: externalApi.editImages");
  },
});

// ---------------------------------------------------------------------------
// 3. externalApi.chatCompletions - /v1/chat/completions (apiKey)
// ---------------------------------------------------------------------------
export const chatCompletions = defineOperation({
  name: "externalApi.chatCompletions",
  domain: "external-api",
  title: "Chat Completions",
  description:
    "通过 /v1/chat/completions 端点进行对话补全。需要有效 API Key。",
  input: z.object({
    model: z.string().describe("模型标识"),
    messages: z.array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.union([
          z.string(),
          z.array(z.record(z.string(), z.unknown())),
        ]),
      }),
    ),
    temperature: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
  }),
  output: z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(z.record(z.string(), z.unknown())),
    usage: z
      .object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
        total_tokens: z.number(),
      })
      .optional(),
  }),
  access: { kind: "apiKey" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["billing", "external-call"],
  async execute() {
    throw new Error("Not yet wired: externalApi.chatCompletions");
  },
});

// ---------------------------------------------------------------------------
// 4. externalApi.responses - /v1/responses (apiKey, Pro+)
// ---------------------------------------------------------------------------
export const responses = defineOperation({
  name: "externalApi.responses",
  domain: "external-api",
  title: "Responses",
  description:
    "通过 /v1/responses 端点获取模型响应。需要有效 API Key，Pro 及以上套餐。",
  input: z.object({
    model: z.string().describe("模型标识"),
    input: z.union([
      z.string(),
      z.array(z.record(z.string(), z.unknown())),
    ]).describe("输入内容"),
    instructions: z.string().optional().describe("系统指令"),
    temperature: z.number().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
  }),
  output: z.object({
    id: z.string(),
    object: z.string(),
    created_at: z.number(),
    model: z.string(),
    output: z.array(z.record(z.string(), z.unknown())),
    usage: z
      .object({
        input_tokens: z.number(),
        output_tokens: z.number(),
        total_tokens: z.number(),
      })
      .optional(),
  }),
  access: { kind: "apiKey", planCapability: "pro" },
  capabilities: [{ capability: "pro" }],
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["billing", "external-call"],
  async execute() {
    throw new Error("Not yet wired: externalApi.responses");
  },
});

// ---------------------------------------------------------------------------
// 5. externalApi.agentImages - /v1/agents/images (apiKey, Ultra+)
// ---------------------------------------------------------------------------
export const agentImages = defineOperation({
  name: "externalApi.agentImages",
  domain: "external-api",
  title: "Agent Images",
  description:
    "通过 /v1/agents/images 端点进行 Agent 图像生成。需要有效 API Key，Ultra 及以上套餐。",
  input: z.object({
    model: z.string().describe("图像生成模型标识"),
    prompt: z.string().describe("图像生成提示词"),
    agent_config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Agent 配置参数"),
    n: z.number().int().positive().optional().describe("生成数量"),
    size: z.string().optional().describe("图像尺寸"),
    quality: z.string().optional().describe("图像质量"),
    response_format: z
      .enum(["url", "b64_json"])
      .optional()
      .describe("响应格式"),
  }),
  output: z.object({
    created: z.number().describe("创建时间戳"),
    data: z.array(
      z.object({
        url: z.string().optional(),
        b64_json: z.string().optional(),
        revised_prompt: z.string().optional(),
      }),
    ),
    taskId: z.string().optional().describe("异步任务 ID"),
  }),
  access: { kind: "apiKey", planCapability: "ultra" },
  capabilities: [{ capability: "ultra" }],
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["billing", "external-call", "storage"],
  async execute() {
    throw new Error("Not yet wired: externalApi.agentImages");
  },
});

// ---------------------------------------------------------------------------
// 6. externalApi.getCredits - /v1/credits (apiKey, read)
// ---------------------------------------------------------------------------
export const getCredits = defineOperation({
  name: "externalApi.getCredits",
  domain: "external-api",
  title: "Get Credits",
  description:
    "通过 /v1/credits 端点查询当前 API Key 关联用户的积分余额。只读操作。",
  input: z.object({}),
  output: z.object({
    credits: z.number().describe("当前积分余额"),
    used: z.number().optional().describe("已使用积分"),
    total: z.number().optional().describe("总积分"),
  }),
  access: { kind: "apiKey" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  async execute() {
    throw new Error("Not yet wired: externalApi.getCredits");
  },
});

// ---------------------------------------------------------------------------
// 7. externalApi.getTask - /v1/images/{taskId} (apiKey, read)
// ---------------------------------------------------------------------------
export const getTask = defineOperation({
  name: "externalApi.getTask",
  domain: "external-api",
  title: "Get Task",
  description:
    "通过 /v1/images/{taskId} 端点查询异步图像生成任务状态。只读操作。",
  input: z.object({
    taskId: z.string().describe("任务 ID"),
  }),
  output: z.object({
    taskId: z.string(),
    status: z
      .enum(["pending", "processing", "completed", "failed"])
      .describe("任务状态"),
    result: z
      .object({
        url: z.string().optional(),
        b64_json: z.string().optional(),
      })
      .optional()
      .describe("任务结果（完成时）"),
    error: z.string().optional().describe("错误信息（失败时）"),
    createdAt: z.number().optional(),
    completedAt: z.number().optional(),
  }),
  access: { kind: "apiKey" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  async execute() {
    throw new Error("Not yet wired: externalApi.getTask");
  },
});

// ---------------------------------------------------------------------------
// 8. externalApi.getModels - /v1/models (apiKey, read)
// ---------------------------------------------------------------------------
export const getModels = defineOperation({
  name: "externalApi.getModels",
  domain: "external-api",
  title: "Get Models",
  description:
    "通过 /v1/models 端点获取可用模型列表。只读操作。",
  input: z.object({}),
  output: z.object({
    object: z.literal("list"),
    data: z.array(
      z.object({
        id: z.string(),
        object: z.literal("model"),
        created: z.number(),
        owned_by: z.string(),
      }),
    ),
  }),
  access: { kind: "apiKey" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  async execute() {
    throw new Error("Not yet wired: externalApi.getModels");
  },
});

// ---------------------------------------------------------------------------
// 9. externalApi.listKeys - getExternalApiKeys (protected, read)
// ---------------------------------------------------------------------------
export const listKeys = defineOperation({
  name: "externalApi.listKeys",
  domain: "external-api",
  title: "List API Keys",
  description:
    "获取当前用户的外部 API Key 列表。需要登录认证。只读操作。",
  input: z.object({
    page: z.number().int().positive().optional().describe("页码"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("每页数量"),
  }),
  output: z.object({
    keys: z.array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        prefix: z.string().describe("Key 前缀（脱敏）"),
        status: z.enum(["active", "revoked", "deleted"]),
        createdAt: z.string(),
        lastUsedAt: z.string().optional(),
      }),
    ),
    total: z.number(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  async execute() {
    throw new Error("Not yet wired: externalApi.listKeys");
  },
});

// ---------------------------------------------------------------------------
// 10. externalApi.createKey - createExternalApiKey (protected)
// ---------------------------------------------------------------------------
export const createKey = defineOperation({
  name: "externalApi.createKey",
  domain: "external-api",
  title: "Create API Key",
  description:
    "创建新的外部 API Key。需要登录认证。",
  input: z.object({
    name: z.string().optional().describe("Key 名称"),
  }),
  output: z.object({
    id: z.string().describe("Key ID"),
    key: z.string().describe("完整 Key（仅创建时返回一次）"),
    name: z.string().optional(),
    prefix: z.string().describe("Key 前缀"),
    createdAt: z.string(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  async execute() {
    throw new Error("Not yet wired: externalApi.createKey");
  },
});

// ---------------------------------------------------------------------------
// 11. externalApi.revokeKey - revokeExternalApiKey (protected + owner)
// ---------------------------------------------------------------------------
export const revokeKey = defineOperation({
  name: "externalApi.revokeKey",
  domain: "external-api",
  title: "Revoke API Key",
  description:
    "撤销外部 API Key（不可逆）。需要登录认证且为 Key 所有者。",
  input: z.object({
    keyId: z.string().describe("要撤销的 Key ID"),
  }),
  output: z.object({
    success: z.boolean(),
    revokedAt: z.string(),
  }),
  access: { kind: "owner", resource: "externalApiKey" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  async execute() {
    throw new Error("Not yet wired: externalApi.revokeKey");
  },
});

// ---------------------------------------------------------------------------
// 12. externalApi.deleteKey - deleteExternalApiKey (protected + owner)
// ---------------------------------------------------------------------------
export const deleteKey = defineOperation({
  name: "externalApi.deleteKey",
  domain: "external-api",
  title: "Delete API Key",
  description:
    "删除外部 API Key。需要登录认证且为 Key 所有者。",
  input: z.object({
    keyId: z.string().describe("要删除的 Key ID"),
  }),
  output: z.object({
    success: z.boolean(),
    deletedAt: z.string(),
  }),
  access: { kind: "owner", resource: "externalApiKey" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  async execute() {
    throw new Error("Not yet wired: externalApi.deleteKey");
  },
});

// ---------------------------------------------------------------------------
// 13. externalApi.updateKeyModeration - updateExternalApiKeyModeration
//     (protected + owner)
// ---------------------------------------------------------------------------
export const updateKeyModeration = defineOperation({
  name: "externalApi.updateKeyModeration",
  domain: "external-api",
  title: "Update Key Moderation",
  description:
    "更新外部 API Key 的内容审核设置。需要登录认证且为 Key 所有者。",
  input: z.object({
    keyId: z.string().describe("Key ID"),
    moderationEnabled: z.boolean().describe("是否启用内容审核"),
    moderationLevel: z
      .enum(["strict", "moderate", "permissive"])
      .optional()
      .describe("审核严格程度"),
  }),
  output: z.object({
    success: z.boolean(),
    updatedAt: z.string(),
  }),
  access: { kind: "owner", resource: "externalApiKey" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  async execute() {
    throw new Error(
      "Not yet wired: externalApi.updateKeyModeration",
    );
  },
});

// ---------------------------------------------------------------------------
// 14. externalApi.updateKeyGroup - updateExternalApiKeyGroup
//     (protected + owner)
// ---------------------------------------------------------------------------
export const updateKeyGroup = defineOperation({
  name: "externalApi.updateKeyGroup",
  domain: "external-api",
  title: "Update Key Group",
  description:
    "更新外部 API Key 的分组归属。需要登录认证且为 Key 所有者。",
  input: z.object({
    keyId: z.string().describe("Key ID"),
    groupId: z.string().nullable().describe("分组 ID，null 表示移出分组"),
  }),
  output: z.object({
    success: z.boolean(),
    updatedAt: z.string(),
  }),
  access: { kind: "owner", resource: "externalApiKey" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  async execute() {
    throw new Error("Not yet wired: externalApi.updateKeyGroup");
  },
});

// ---------------------------------------------------------------------------
// 15. externalApi.updateKeyQuota - updateExternalApiKeyQuota
//     (protected + owner)
// ---------------------------------------------------------------------------
export const updateKeyQuota = defineOperation({
  name: "externalApi.updateKeyQuota",
  domain: "external-api",
  title: "Update Key Quota",
  description:
    "更新外部 API Key 的配额限制。需要登录认证且为 Key 所有者。",
  input: z.object({
    keyId: z.string().describe("Key ID"),
    dailyLimit: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe("每日调用上限，null 表示无限制"),
    monthlyLimit: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .describe("每月调用上限，null 表示无限制"),
    creditsLimit: z
      .number()
      .nonnegative()
      .nullable()
      .optional()
      .describe("积分消耗上限，null 表示无限制"),
  }),
  output: z.object({
    success: z.boolean(),
    updatedAt: z.string(),
  }),
  access: { kind: "owner", resource: "externalApiKey" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  async execute() {
    throw new Error("Not yet wired: externalApi.updateKeyQuota");
  },
});

// ---------------------------------------------------------------------------
// 16. externalApi.updateKeyRelay - updateExternalApiKeyRelay
//     (protected + owner)
// ---------------------------------------------------------------------------
export const updateKeyRelay = defineOperation({
  name: "externalApi.updateKeyRelay",
  domain: "external-api",
  title: "Update Key Relay",
  description:
    "更新外部 API Key 的纯中转设置。需要登录认证且为 Key 所有者。",
  input: z.object({
    keyId: z.string().describe("Key ID"),
    relayEnabled: z.boolean().describe("是否启用纯中转模式"),
    relayEndpoint: z
      .string()
      .url()
      .optional()
      .describe("中转目标端点 URL"),
    relayApiKey: z
      .string()
      .optional()
      .describe("中转目标 API Key"),
  }),
  output: z.object({
    success: z.boolean(),
    updatedAt: z.string(),
  }),
  access: { kind: "owner", resource: "externalApiKey" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  async execute() {
    throw new Error("Not yet wired: externalApi.updateKeyRelay");
  },
});

// ---------------------------------------------------------------------------
// 17. externalApi.adminSetKeyStatus - setExternalApiKeyStatus (admin)
// ---------------------------------------------------------------------------
export const adminSetKeyStatus = defineOperation({
  name: "externalApi.adminSetKeyStatus",
  domain: "external-api",
  title: "Admin Set Key Status",
  description:
    "管理员设置外部 API Key 状态（启用/禁用/撤销）。需要管理员权限。",
  input: z.object({
    keyId: z.string().describe("Key ID"),
    status: z
      .enum(["active", "disabled", "revoked"])
      .describe("目标状态"),
    reason: z.string().optional().describe("状态变更原因"),
  }),
  output: z.object({
    success: z.boolean(),
    previousStatus: z.string(),
    newStatus: z.string(),
    updatedAt: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  async execute() {
    throw new Error("Not yet wired: externalApi.adminSetKeyStatus");
  },
});
