/**
 * UOL (Unified Operation Layer) - 核心类型定义
 *
 * 职责：定义所有操作注册项的类型结构，包括领域分类、权限模型、
 * 幂等规格、副作用声明、操作上下文等。
 *
 * 使用方：registry.ts（注册）、invoke.ts（网关执行）、access.ts（鉴权）
 * 关键依赖：zod（输入/输出 schema 校验）、principal.ts（身份类型）
 */
import type { z } from "zod";

import type { Principal } from "./principal";

/**
 * 业务领域枚举 - 来自功能接口盘点表的 9+1 个领域。
 * 每个操作归属唯一领域，用于按域过滤、审计分类、MCP 工具分组。
 */
export type OperationDomain =
  | "image-generation"
  | "credits"
  | "subscription"
  | "user-auth"
  | "image-backend-pool"
  | "system-settings"
  | "storage"
  | "moderation"
  | "external-api"
  | "support";

/**
 * 访问控制要求 - 声明式描述操作的身份要求。
 * assertAccess() 在 invoke 网关单点执行，传输层不重复鉴权。
 *
 * - public: 无需身份
 * - protected: 需登录用户或 API key
 * - owner: 需资源归属校验（延迟到 execute 内由 ctx.assertOwnership 执行）
 * - admin / superAdmin / imageBackendPoolViewer: 管理角色要求
 * - apiKey: 仅 API key 可调用（plan capability 进一步细化在 capabilities 字段）
 * - cron / webhook / proxySecret / system: 非用户身份的内部/外部调用者
 */
export type AccessRequirement =
  | { kind: "public" }
  | { kind: "protected" }
  | { kind: "owner"; resource: string }
  | { kind: "admin" }
  | { kind: "superAdmin" }
  | { kind: "imageBackendPoolViewer" }
  | { kind: "apiKey"; planCapability?: string }
  | { kind: "cron" }
  | { kind: "webhook"; provider: "creem" | "epay" }
  | { kind: "proxySecret" }
  | { kind: "system" };

/**
 * 能力位要求 - 操作可声明需要的套餐能力。
 * 静态字符串直接匹配 plan-capabilities；derive 函数根据输入动态推导。
 */
export type CapabilityRequirement =
  | { capability: string }
  | { derive: (input: unknown) => string[] };

/**
 * 幂等规格 - 声明操作的幂等性要求。
 *
 * - natural: 天然幂等（GET / 纯读取），无需额外处理
 * - none: 非幂等操作（如发消息），允许重复
 * - required: 必须携带幂等键，网关在执行前强制校验 keyField 非空
 *   scope 指明键的隔离粒度（per-user 或 global）
 */
export type IdempotencySpec =
  | { kind: "natural" }
  | { kind: "none" }
  | { kind: "required"; keyField: string; scope: "per-user" | "global" };

/**
 * 副作用标签 - 声明操作可能触发的副作用类型。
 * 用于审计、MCP 工具 description 生成、agent 决策。
 */
export type SideEffect =
  | "billing"
  | "email"
  | "storage"
  | "external-call"
  | "cache"
  | "audit"
  | "queue";

/**
 * 操作执行上下文 - invoke 网关构建并传入 execute 函数。
 *
 * - requestId: 全局唯一请求标识（用于日志关联与审计追踪）
 * - callbacks: 可选回调集合（未来扩展 SSE/webhook 通知等）
 * - assertOwnership: owner 类操作在 execute 内调用以验证资源归属
 */
export interface OperationContext {
  requestId: string;
  callbacks?: Record<string, unknown> | undefined;
  assertOwnership: (resource: string, ownerId: string) => void;
}

/**
 * 操作定义 - UOL 注册表中的核心单元。
 *
 * 每个功能必须先注册为 OperationDefinition 才能被传输层或 agent 调用。
 * 类型参数 TInput/TOutput 确保 execute 的类型安全。
 *
 * 字段说明：
 * - name: 全局唯一操作名（如 "credits.consume"）
 * - domain: 所属业务领域
 * - title: 人类可读标题（面向 MCP 工具列表）
 * - description: 详细描述（面向 agent / 文档）
 * - input / output: Zod schema 提供运行时校验与类型推导
 * - access: 声明式权限要求
 * - capabilities: 可选套餐能力位要求
 * - readOnly: true 表示纯读操作（GET 语义），不改变系统状态
 * - destructive: true 表示不可逆操作（删除、封禁等），agent 应二次确认
 * - idempotency: 幂等规格
 * - sideEffects: 可能的副作用列表
 * - processLocalState: true 表示依赖进程内存状态（如 cache），不适合跨进程调用
 * - hasMaintenanceWrite: true 表示含维护性写入（不面向终端用户的后台写入）
 * - execute: 传输无关的业务逻辑执行体
 */
export interface OperationDefinition<
  TInput = unknown,
  TOutput = unknown,
> {
  name: string;
  domain: OperationDomain;
  title: string;
  description: string;
  input: z.ZodType<TInput>;
  output: z.ZodType<TOutput>;
  access: AccessRequirement;
  capabilities?: CapabilityRequirement[];
  readOnly: boolean;
  destructive: boolean;
  idempotency: IdempotencySpec;
  sideEffects: SideEffect[];
  processLocalState?: boolean;
  hasMaintenanceWrite?: boolean;
  execute: (
    input: TInput,
    principal: Principal,
    ctx: OperationContext,
  ) => Promise<TOutput>;
}

/** 从 OperationDefinition 提取输入类型 */
export type OperationInput<T extends OperationDefinition> =
  T extends OperationDefinition<infer I, unknown> ? I : never;

/** 从 OperationDefinition 提取输出类型 */
export type OperationOutput<T extends OperationDefinition> =
  T extends OperationDefinition<unknown, infer O> ? O : never;
