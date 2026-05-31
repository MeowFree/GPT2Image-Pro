/**
 * UOL 操作注册 - image-backend-pool 域
 *
 * 职责：注册图像后端池管理相关的所有操作定义（组/账号/API/Sub2API 同步/CRON 等）。
 * 使用方：UOL 注册表（进程启动时自动注册）、invokeOperation 网关。
 * 关键依赖：../registry（defineOperation）、zod（schema）。
 *
 * 所有 execute 函数为 stub，待后续接线到实际 service 层。
 */
import { z } from "zod";

import { defineOperation } from "../registry";

// ---------------------------------------------------------------------------
// 1. pool.getSelectableGroups - 获取当前用户可选的后端组列表
// ---------------------------------------------------------------------------
export const getSelectableGroups = defineOperation({
  name: "pool.getSelectableGroups",
  domain: "image-backend-pool",
  title: "获取可选后端组",
  description:
    "获取当前用户可选择的图像后端组列表，结合用户套餐能力判定可见组。",
  input: z.object({}),
  output: z.object({
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        isDefault: z.boolean(),
      }),
    ),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: pool.getSelectableGroups");
  },
});

// ---------------------------------------------------------------------------
// 2. pool.setPreference - 设置用户后端偏好
// ---------------------------------------------------------------------------
export const setPreference = defineOperation({
  name: "pool.setPreference",
  domain: "image-backend-pool",
  title: "设置用户后端偏好",
  description: "设置当前用户的图像后端组偏好（upsert）。",
  input: z.object({
    groupId: z.string().nullable(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.setPreference");
  },
});

// ---------------------------------------------------------------------------
// 3. pool.getGroupOptions - 获取后端组选项列表
// ---------------------------------------------------------------------------
export const getGroupOptions = defineOperation({
  name: "pool.getGroupOptions",
  domain: "image-backend-pool",
  title: "获取后端组选项",
  description: "获取图像后端组选项列表（用于表单选择器等场景）。",
  input: z.object({}),
  output: z.object({
    options: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    ),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: pool.getGroupOptions");
  },
});

// ---------------------------------------------------------------------------
// 4. pool.getAdminPool - 管理后台获取池总览
// ---------------------------------------------------------------------------
export const getAdminPool = defineOperation({
  name: "pool.getAdminPool",
  domain: "image-backend-pool",
  title: "获取管理后台池总览",
  description:
    "获取图像后端池管理总览数据（组、账号、API 及状态统计），" +
    "供管理后台池管理页面使用。",
  input: z.object({}),
  output: z.record(z.string(), z.unknown()),
  access: { kind: "imageBackendPoolViewer" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: pool.getAdminPool");
  },
});

// ---------------------------------------------------------------------------
// 5. pool.saveGroup - 保存（新建/更新）后端组
// ---------------------------------------------------------------------------
export const saveGroup = defineOperation({
  name: "pool.saveGroup",
  domain: "image-backend-pool",
  title: "保存后端组",
  description:
    "新建或更新图像后端组（含子组、倍率、isDefault 互斥逻辑）。",
  input: z.object({
    id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    parentId: z.string().nullable().optional(),
    isDefault: z.boolean().optional(),
    costMultiplier: z.number().optional(),
    requiredCapability: z.string().nullable().optional(),
  }),
  output: z.object({
    id: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.saveGroup");
  },
});

// ---------------------------------------------------------------------------
// 6. pool.deleteGroup - 删除后端组
// ---------------------------------------------------------------------------
export const deleteGroup = defineOperation({
  name: "pool.deleteGroup",
  domain: "image-backend-pool",
  title: "删除后端组",
  description: "删除指定图像后端组并解绑其下成员。",
  input: z.object({
    id: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.deleteGroup");
  },
});

// ---------------------------------------------------------------------------
// 7. pool.saveAccount - 保存（新建/更新）后端账号
// ---------------------------------------------------------------------------
export const saveAccount = defineOperation({
  name: "pool.saveAccount",
  domain: "image-backend-pool",
  title: "保存后端账号",
  description:
    "新建或更新图像后端账号（含 OAuth RT 换 AT 外呼、hash 去重）。" +
    "拒绝修改 Sub2API 托管的 RT。",
  input: z.object({
    id: z.string().optional(),
    groupId: z.string().nullable().optional(),
    accountType: z.string(),
    refreshToken: z.string().optional(),
    accessToken: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.object({
    id: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call", "audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.saveAccount");
  },
});

// ---------------------------------------------------------------------------
// 8. pool.bulkUpdateAccounts - 批量更新后端账号
// ---------------------------------------------------------------------------
export const bulkUpdateAccounts = defineOperation({
  name: "pool.bulkUpdateAccounts",
  domain: "image-backend-pool",
  title: "批量更新后端账号",
  description:
    "批量更新图像后端账号属性（含 resetAvailability 清除冷却）。",
  input: z.object({
    ids: z.array(z.string()),
    updates: z.record(z.string(), z.unknown()),
    resetAvailability: z.boolean().optional(),
  }),
  output: z.object({
    updatedCount: z.number(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.bulkUpdateAccounts");
  },
});

// ---------------------------------------------------------------------------
// 9. pool.bulkDeleteAccounts - 批量删除后端账号
// ---------------------------------------------------------------------------
export const bulkDeleteAccounts = defineOperation({
  name: "pool.bulkDeleteAccounts",
  domain: "image-backend-pool",
  title: "批量删除后端账号",
  description: "分批删除指定的图像后端账号。",
  input: z.object({
    ids: z.array(z.string()),
  }),
  output: z.object({
    deletedCount: z.number(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.bulkDeleteAccounts");
  },
});

// ---------------------------------------------------------------------------
// 10. pool.deleteMember - 删除单个后端成员（账号或 API）
// ---------------------------------------------------------------------------
export const deleteMember = defineOperation({
  name: "pool.deleteMember",
  domain: "image-backend-pool",
  title: "删除后端成员",
  description: "删除单个图像后端成员（账号或第三方 API）。",
  input: z.object({
    id: z.string(),
    memberType: z.enum(["account", "api"]),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.deleteMember");
  },
});

// ---------------------------------------------------------------------------
// 11. pool.saveApi - 保存（新建/更新）第三方 API
// ---------------------------------------------------------------------------
export const saveApi = defineOperation({
  name: "pool.saveApi",
  domain: "image-backend-pool",
  title: "保存第三方 API",
  description:
    "新建或更新图像后端第三方 API 配置（新建时 apiKey 必填）。",
  input: z.object({
    id: z.string().optional(),
    groupId: z.string().nullable().optional(),
    name: z.string().optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.object({
    id: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.saveApi");
  },
});

// ---------------------------------------------------------------------------
// 12. pool.importFromRefreshTokens - 从 RT 批量导入账号
// ---------------------------------------------------------------------------
export const importFromRefreshTokens = defineOperation({
  name: "pool.importFromRefreshTokens",
  domain: "image-backend-pool",
  title: "从 RT 导入账号",
  description:
    "通过 Refresh Token 列表批量创建账号（逐条 OAuth 换 AT + " +
    "hash 去重，支持 startIndex 续传）。",
  input: z.object({
    groupId: z.string().nullable().optional(),
    refreshTokens: z.array(z.string()),
    startIndex: z.number().optional(),
  }),
  output: z.object({
    imported: z.number(),
    skipped: z.number(),
    errors: z.array(
      z.object({
        index: z.number(),
        message: z.string(),
      }),
    ),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call", "audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.importFromRefreshTokens");
  },
});

// ---------------------------------------------------------------------------
// 13. pool.importWebFromAccessTokens - 从 AT 批量导入 Web 账号
// ---------------------------------------------------------------------------
export const importWebFromAccessTokens = defineOperation({
  name: "pool.importWebFromAccessTokens",
  domain: "image-backend-pool",
  title: "从 AT 导入 Web 账号",
  description:
    "通过 Access Token 列表批量创建 Web 类型账号（hash 去重）。",
  input: z.object({
    groupId: z.string().nullable().optional(),
    accessTokens: z.array(z.string()),
  }),
  output: z.object({
    imported: z.number(),
    skipped: z.number(),
    errors: z.array(
      z.object({
        index: z.number(),
        message: z.string(),
      }),
    ),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error(
      "Not yet wired: pool.importWebFromAccessTokens",
    );
  },
});

// ---------------------------------------------------------------------------
// 14. pool.refreshAccountInfo - 刷新单个账号信息
// ---------------------------------------------------------------------------
export const refreshAccountInfo = defineOperation({
  name: "pool.refreshAccountInfo",
  domain: "image-backend-pool",
  title: "刷新单个账号信息",
  description:
    "拉取远端最新信息更新单个后端账号的 metadata 与 status。",
  input: z.object({
    accountId: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call"],
  execute: async () => {
    throw new Error("Not yet wired: pool.refreshAccountInfo");
  },
});

// ---------------------------------------------------------------------------
// 15. pool.refreshAccountsInfo - 批量刷新账号信息
// ---------------------------------------------------------------------------
export const refreshAccountsInfo = defineOperation({
  name: "pool.refreshAccountsInfo",
  domain: "image-backend-pool",
  title: "批量刷新账号信息",
  description:
    "并发（10 并发限制）拉取远端信息批量更新后端账号 metadata 与 status。",
  input: z.object({
    accountIds: z.array(z.string()),
  }),
  output: z.object({
    successCount: z.number(),
    failedCount: z.number(),
    errors: z.array(
      z.object({
        accountId: z.string(),
        message: z.string(),
      }),
    ),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call"],
  execute: async () => {
    throw new Error("Not yet wired: pool.refreshAccountsInfo");
  },
});

// ---------------------------------------------------------------------------
// 16. pool.getSub2ApiStatus - 获取 Sub2API 同步状态
// ---------------------------------------------------------------------------
export const getSub2ApiStatus = defineOperation({
  name: "pool.getSub2ApiStatus",
  domain: "image-backend-pool",
  title: "获取 Sub2API 同步状态",
  description: "探测 Sub2API 外部数据库连接状态。",
  input: z.object({}),
  output: z.object({
    connected: z.boolean(),
    message: z.string().optional(),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  execute: async () => {
    throw new Error("Not yet wired: pool.getSub2ApiStatus");
  },
});

// ---------------------------------------------------------------------------
// 17. pool.getSub2ApiSourceGroups - 获取 Sub2API 源分组
// ---------------------------------------------------------------------------
export const getSub2ApiSourceGroups = defineOperation({
  name: "pool.getSub2ApiSourceGroups",
  domain: "image-backend-pool",
  title: "获取 Sub2API 源分组",
  description: "从 Sub2API 外部数据库读取可用的源账号分组列表。",
  input: z.object({}),
  output: z.object({
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        accountCount: z.number().optional(),
      }),
    ),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  execute: async () => {
    throw new Error("Not yet wired: pool.getSub2ApiSourceGroups");
  },
});

// ---------------------------------------------------------------------------
// 18. pool.getSub2ApiAutoSyncTasks - 获取自动同步任务列表
// ---------------------------------------------------------------------------
export const getSub2ApiAutoSyncTasks = defineOperation({
  name: "pool.getSub2ApiAutoSyncTasks",
  domain: "image-backend-pool",
  title: "获取自动同步任务列表",
  description:
    "读取 system-settings KV 中存储的 Sub2API 自动同步任务配置。",
  input: z.object({}),
  output: z.object({
    tasks: z.array(z.record(z.string(), z.unknown())),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error(
      "Not yet wired: pool.getSub2ApiAutoSyncTasks",
    );
  },
});

// ---------------------------------------------------------------------------
// 19. pool.syncSub2ApiAccounts - 同步 Sub2API 账号到池
// ---------------------------------------------------------------------------
export const syncSub2ApiAccounts = defineOperation({
  name: "pool.syncSub2ApiAccounts",
  domain: "image-backend-pool",
  title: "同步 Sub2API 账号",
  description:
    "从 Sub2API 外部数据库读取账号并批量 upsert 到本地池（hash 去重）。",
  input: z.object({
    sourceGroupId: z.string().optional(),
    targetGroupId: z.string().nullable().optional(),
    overwriteLocalUnavailableState: z.boolean().optional(),
  }),
  output: z.object({
    imported: z.number(),
    updated: z.number(),
    removed: z.number(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call", "audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.syncSub2ApiAccounts");
  },
});

// ---------------------------------------------------------------------------
// 20. pool.runSub2ApiManualSync - 手动执行 Sub2API 同步
// ---------------------------------------------------------------------------
export const runSub2ApiManualSync = defineOperation({
  name: "pool.runSub2ApiManualSync",
  domain: "image-backend-pool",
  title: "手动 Sub2API 同步",
  description:
    "手动触发一次 Sub2API 同步（同 syncSub2ApiAccounts + 落任务记录）。",
  input: z.object({
    sourceGroupId: z.string().optional(),
    targetGroupId: z.string().nullable().optional(),
    overwriteLocalUnavailableState: z.boolean().optional(),
  }),
  output: z.object({
    imported: z.number(),
    updated: z.number(),
    removed: z.number(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call", "audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.runSub2ApiManualSync");
  },
});

// ---------------------------------------------------------------------------
// 21. pool.runSub2ApiAutoSyncNow - 立即执行指定自动同步任务
// ---------------------------------------------------------------------------
export const runSub2ApiAutoSyncNow = defineOperation({
  name: "pool.runSub2ApiAutoSyncNow",
  domain: "image-backend-pool",
  title: "立即执行自动同步任务",
  description:
    "立即执行指定的 Sub2API 自动同步任务并更新任务最后执行结果。",
  input: z.object({
    taskId: z.string(),
  }),
  output: z.object({
    imported: z.number(),
    updated: z.number(),
    removed: z.number(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call", "audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.runSub2ApiAutoSyncNow");
  },
});

// ---------------------------------------------------------------------------
// 22. pool.setSub2ApiTaskEnabled - 启停自动同步任务
// ---------------------------------------------------------------------------
export const setSub2ApiTaskEnabled = defineOperation({
  name: "pool.setSub2ApiTaskEnabled",
  domain: "image-backend-pool",
  title: "启停自动同步任务",
  description: "设置 Sub2API 自动同步任务的 enabled 状态。",
  input: z.object({
    taskId: z.string(),
    enabled: z.boolean(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.setSub2ApiTaskEnabled");
  },
});

// ---------------------------------------------------------------------------
// 23. pool.setSub2ApiTaskOverwrite - 设置任务覆盖本地不可用状态
// ---------------------------------------------------------------------------
export const setSub2ApiTaskOverwrite = defineOperation({
  name: "pool.setSub2ApiTaskOverwrite",
  domain: "image-backend-pool",
  title: "设置任务覆盖本地不可用状态",
  description:
    "设置 Sub2API 自动同步任务的 overwriteLocalUnavailableState 选项。",
  input: z.object({
    taskId: z.string(),
    overwriteLocalUnavailableState: z.boolean(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error(
      "Not yet wired: pool.setSub2ApiTaskOverwrite",
    );
  },
});

// ---------------------------------------------------------------------------
// 24. pool.updateSub2ApiTaskOptions - 更新自动同步任务配置
// ---------------------------------------------------------------------------
export const updateSub2ApiTaskOptions = defineOperation({
  name: "pool.updateSub2ApiTaskOptions",
  domain: "image-backend-pool",
  title: "更新自动同步任务配置",
  description: "覆盖指定 Sub2API 自动同步任务的配置选项。",
  input: z.object({
    taskId: z.string(),
    options: z.record(z.string(), z.unknown()),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error(
      "Not yet wired: pool.updateSub2ApiTaskOptions",
    );
  },
});

// ---------------------------------------------------------------------------
// 25. pool.deleteSub2ApiTask - 删除自动同步任务
// ---------------------------------------------------------------------------
export const deleteSub2ApiTask = defineOperation({
  name: "pool.deleteSub2ApiTask",
  domain: "image-backend-pool",
  title: "删除自动同步任务",
  description: "从 system-settings KV 中移除指定的自动同步任务。",
  input: z.object({
    taskId: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.deleteSub2ApiTask");
  },
});

// ---------------------------------------------------------------------------
// 26. pool.cronSub2ApiSync - CRON 周期性 Sub2API 同步
// ---------------------------------------------------------------------------
export const cronSub2ApiSync = defineOperation({
  name: "pool.cronSub2ApiSync",
  domain: "image-backend-pool",
  title: "CRON Sub2API 周期同步",
  description:
    "定时任务：遍历所有 enabled 的自动同步任务执行同步，" +
    "按 interval/force 策略跳过或执行。",
  input: z.object({}),
  output: z.object({
    tasksExecuted: z.number(),
    tasksSkipped: z.number(),
  }),
  access: { kind: "cron" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call", "audit"],
  execute: async () => {
    throw new Error("Not yet wired: pool.cronSub2ApiSync");
  },
});

// ---------------------------------------------------------------------------
// 27. pool.cronRefreshStale - CRON 刷新陈旧 Web 账号
// ---------------------------------------------------------------------------
export const cronRefreshStale = defineOperation({
  name: "pool.cronRefreshStale",
  domain: "image-backend-pool",
  title: "CRON 刷新陈旧 Web 账号",
  description:
    "定时任务：拉取远端信息刷新超过 staleMinutes 未更新的 Web 账号。",
  input: z.object({}),
  output: z.object({
    refreshedCount: z.number(),
    failedCount: z.number(),
  }),
  access: { kind: "cron" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["external-call"],
  execute: async () => {
    throw new Error("Not yet wired: pool.cronRefreshStale");
  },
});
