/**
 * UOL Operations - image-generation 域
 *
 * 职责：注册图像生成领域的所有操作定义到全局注册表。
 * 包含：统一管线核心、Server Action 简化入口、删除、状态查询、
 * 历史/画廊/统计查询族、后端配置解析、Web 候选图选定。
 *
 * 使用方：operations/index.ts 副作用导入触发注册；
 * invoke.ts 通过 getOperation 获取并执行。
 *
 * 关键依赖：../registry.ts（defineOperation）、zod（schema）
 *
 * 注意：execute 函数均为 STUB，Phase 2 接线时替换为真实 service 委托。
 * 不从 apps/web 或 @repo/database 导入任何内容。
 */
import { z } from "zod";

import { defineOperation } from "../registry";

// ---------------------------------------------------------------------------
// 1. image.generate - 统一管线核心（runImageGenerationForUser）
// 5 个 v1 handler + 3 个 web 路由汇入的单一生图入口
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.generate",
  domain: "image-generation",
  title: "图像生成（统一管线）",
  description:
    "统一图像生成管线核心。接受 prompt/参数，执行扣费、外呼生图后端、" +
    "存储结果、审核。所有传输层（v1 API / Server Action / Web 路由）" +
    "最终汇入此操作。",
  input: z.object({
    userId: z.string(),
    prompt: z.string(),
    negativePrompt: z.string().optional(),
    model: z.string().optional(),
    size: z.string().optional(),
    quality: z.string().optional(),
    style: z.string().optional(),
    count: z.number().int().positive().optional(),
    generationId: z.string().optional(),
    /** 后端组偏好 */
    backendGroupId: z.string().optional(),
    /** 纯中转模式（不落库用户数据） */
    relayOnly: z.boolean().optional(),
    /** 不透明扩展参数（edit/chat 模式附加字段） */
    extra: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.object({
    generationId: z.string(),
    images: z.array(
      z.object({
        url: z.string(),
        revisedPrompt: z.string().optional(),
      }),
    ),
    creditsUsed: z.number().optional(),
    model: z.string().optional(),
  }),
  access: { kind: "protected" },
  capabilities: [
    {
      derive: (input: unknown) => {
        const caps: string[] = [];
        const i = input as Record<string, unknown>;
        if (typeof i.count === "number" && i.count > 1) {
          caps.push("imageGeneration.batch");
        }
        return caps;
      },
    },
  ],
  readOnly: false,
  destructive: false,
  idempotency: {
    kind: "required",
    keyField: "generationId",
    scope: "per-user",
  },
  sideEffects: ["billing", "storage", "external-call"],
  processLocalState: true,
  execute: async () => {
    throw new Error("Not yet wired: image.generate");
  },
});

// ---------------------------------------------------------------------------
// 2. image.generateAction - Server Action 简化入口（generateImageAction）
// 仅单图，精简 schema，底层委托 image.generate
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.generateAction",
  domain: "image-generation",
  title: "图像生成（Server Action 简化）",
  description:
    "面向 UI 的简化生图操作，仅支持单图，精简参数。" +
    "底层委托统一管线 runImageGenerationForUser。",
  input: z.object({
    prompt: z.string().min(1),
    model: z.string().optional(),
    size: z.string().optional(),
    quality: z.string().optional(),
    style: z.string().optional(),
  }),
  output: z.object({
    generationId: z.string(),
    imageUrl: z.string(),
    revisedPrompt: z.string().optional(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["billing", "storage", "external-call"],
  processLocalState: true,
  execute: async () => {
    throw new Error("Not yet wired: image.generateAction");
  },
});

// ---------------------------------------------------------------------------
// 3. image.delete - 删除生成记录及孤立图（deleteGenerationAction）
// 近似幂等：已删除的记录再次删除不报错
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.delete",
  domain: "image-generation",
  title: "删除生成记录",
  description:
    "删除用户的生成记录及其关联的存储对象（best-effort 清理）。" +
    "需校验资源归属，不涉及扣费。近似幂等。",
  input: z.object({
    generationId: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "owner", resource: "generation" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  execute: async () => {
    throw new Error("Not yet wired: image.delete");
  },
});

// ---------------------------------------------------------------------------
// 4. image.getStatus - 生成状态查询（getGenerationStatus）
// 纯读，幂等只读
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.getStatus",
  domain: "image-generation",
  title: "查询生成状态",
  description:
    "查询指定 generationId 的生成状态（pending/processing/completed/failed）。" +
    "纯只读操作，需校验资源归属。",
  input: z.object({
    generationId: z.string(),
  }),
  output: z.object({
    generationId: z.string(),
    status: z.enum(["pending", "processing", "completed", "failed"]),
    progress: z.number().optional(),
    error: z.string().optional(),
    completedAt: z.string().optional(),
  }),
  access: { kind: "owner", resource: "generation" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: image.getStatus");
  },
});

// ---------------------------------------------------------------------------
// 5. image.getUserGenerations - 用户生成历史（分页）
// 语义只读，可能触发过期 pending 清理（维护性写入）
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.getUserGenerations",
  domain: "image-generation",
  title: "获取用户生成历史",
  description:
    "分页获取用户的图像生成历史记录。" +
    "可能触发 expireStalePendingGenerations（维护性写入）。",
  input: z.object({
    userId: z.string(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().optional(),
    status: z
      .enum(["pending", "processing", "completed", "failed"])
      .optional(),
  }),
  output: z.object({
    generations: z.array(
      z.object({
        id: z.string(),
        prompt: z.string(),
        status: z.string(),
        model: z.string().optional(),
        imageUrl: z.string().optional(),
        createdAt: z.string(),
      }),
    ),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  hasMaintenanceWrite: true,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: image.getUserGenerations");
  },
});

// ---------------------------------------------------------------------------
// 6. image.getUserGenerationCount - 用户生成总数
// 语义只读，可能触发过期清理
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.getUserGenerationCount",
  domain: "image-generation",
  title: "获取用户生成总数",
  description:
    "获取用户的图像生成总数。" +
    "可能触发 expireStalePendingGenerations（维护性写入）。",
  input: z.object({
    userId: z.string(),
  }),
  output: z.object({
    count: z.number(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  hasMaintenanceWrite: true,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: image.getUserGenerationCount");
  },
});

// ---------------------------------------------------------------------------
// 7. image.getUserRecentGenerations - 用户最近生成
// 语义只读，可能触发过期清理
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.getUserRecentGenerations",
  domain: "image-generation",
  title: "获取用户最近生成",
  description:
    "获取用户最近的图像生成记录（通常用于首页/仪表板展示）。" +
    "可能触发 expireStalePendingGenerations（维护性写入）。",
  input: z.object({
    userId: z.string(),
    limit: z.number().int().positive().optional(),
  }),
  output: z.object({
    generations: z.array(
      z.object({
        id: z.string(),
        prompt: z.string(),
        status: z.string(),
        model: z.string().optional(),
        imageUrl: z.string().optional(),
        createdAt: z.string(),
      }),
    ),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  hasMaintenanceWrite: true,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: image.getUserRecentGenerations");
  },
});

// ---------------------------------------------------------------------------
// 8. image.getGenerationById - 按 ID 获取单条生成记录
// 语义只读
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.getGenerationById",
  domain: "image-generation",
  title: "按 ID 获取生成记录",
  description:
    "按 generationId 获取单条生成记录详情，含图片 URL、参数快照等。" +
    "需校验资源归属。",
  input: z.object({
    generationId: z.string(),
  }),
  output: z.object({
    id: z.string(),
    userId: z.string(),
    prompt: z.string(),
    negativePrompt: z.string().optional(),
    status: z.string(),
    model: z.string().optional(),
    size: z.string().optional(),
    quality: z.string().optional(),
    style: z.string().optional(),
    imageUrl: z.string().optional(),
    revisedPrompt: z.string().optional(),
    creditsUsed: z.number().optional(),
    createdAt: z.string(),
    completedAt: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  access: { kind: "owner", resource: "generation" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: image.getGenerationById");
  },
});

// ---------------------------------------------------------------------------
// 9. image.getGenerationStats - 全局生成统计（管理员）
// 管理员专用统计视图
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.getGenerationStats",
  domain: "image-generation",
  title: "获取全局生成统计",
  description:
    "获取全局图像生成统计数据（总量、按模型/日期分布等）。" +
    "仅管理员可访问。",
  input: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    groupBy: z.enum(["day", "week", "month"]).optional(),
  }),
  output: z.object({
    totalGenerations: z.number(),
    totalCreditsUsed: z.number(),
    byModel: z.record(z.string(), z.number()).optional(),
    byDate: z
      .array(
        z.object({
          date: z.string(),
          count: z.number(),
          creditsUsed: z.number(),
        }),
      )
      .optional(),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: image.getGenerationStats");
  },
});

// ---------------------------------------------------------------------------
// 10. image.getUserApiConfig - 用户 API 配置解析（getUserApiConfig）
// 包含 customApi 校验 + SSRF DNS 检测 + 池选号
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.getUserApiConfig",
  domain: "image-generation",
  title: "获取用户 API 配置",
  description:
    "解析用户的图像生成后端配置：自定义 API 校验（含 SSRF DNS 检测）、" +
    "后端池选号等。解析幂等但池选号非确定性。",
  input: z.object({
    userId: z.string(),
    model: z.string().optional(),
    backendGroupId: z.string().optional(),
  }),
  output: z.object({
    apiEndpoint: z.string(),
    apiKey: z.string(),
    model: z.string(),
    isCustom: z.boolean(),
    backendAccountId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  execute: async () => {
    throw new Error("Not yet wired: image.getUserApiConfig");
  },
});

// ---------------------------------------------------------------------------
// 11. image.getEffectiveConfig - 有效配置解析（getEffectiveConfig）
// 合并系统默认、用户偏好、请求参数后的最终配置
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.getEffectiveConfig",
  domain: "image-generation",
  title: "获取有效生成配置",
  description:
    "合并系统默认配置、用户偏好、请求参数后的最终生效配置。" +
    "用于前端展示当前生效参数。解析幂等（池选号非确定）。",
  input: z.object({
    userId: z.string(),
    model: z.string().optional(),
    backendGroupId: z.string().optional(),
  }),
  output: z.object({
    model: z.string(),
    size: z.string(),
    quality: z.string(),
    style: z.string().optional(),
    backendGroupId: z.string().optional(),
    backendGroupName: z.string().optional(),
    maxCount: z.number(),
    availableModels: z.array(z.string()).optional(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: image.getEffectiveConfig");
  },
});

// ---------------------------------------------------------------------------
// 12. image.selectWebCandidate - Web 候选图选定（selectChatGptWebImageCandidate）
// 强耦合 ChatGPT Web，外呼 + DB 写 metadata，无扣费
// ---------------------------------------------------------------------------
defineOperation({
  name: "image.selectWebCandidate",
  domain: "image-generation",
  title: "选定 Web 候选图",
  description:
    "选定 ChatGPT Web 模式生成的候选图像，触发外呼 ChatGPT Web 获取最终图并更新 DB metadata。" +
    "幂等（无扣费），但每次外呼 Web。需资源归属校验 + web 账号验证。",
  input: z.object({
    generationId: z.string(),
    candidateIndex: z.number().int().min(0),
    webAccountId: z.string().optional(),
  }),
  output: z.object({
    imageUrl: z.string(),
    generationId: z.string(),
    success: z.boolean(),
  }),
  access: { kind: "owner", resource: "generation" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  execute: async () => {
    throw new Error("Not yet wired: image.selectWebCandidate");
  },
});
