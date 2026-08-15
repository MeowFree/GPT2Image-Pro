/**
 * UOL Operations - system-settings 领域
 *
 * 职责：注册系统设置相关的所有操作定义（快照读取、更新、环境变量导入/同步、默认值初始化等）。
 * 使用方：UOL 注册表（通过 operations/index.ts 统一加载）。
 * 关键依赖：../registry.ts (defineOperation)、zod (schema 校验)。
 *
 * execute 函数接入实际 service 层实现。
 */
import { z } from "zod";
import {
  destroyGenerationPhotosByMaxCount,
  shouldRunMaxCountCleanupOnSettingsChange,
} from "../../generation-maintenance";
import { logError } from "../../logger";
import { bootstrapSystemSettingsEnv } from "../../system-settings/bootstrap";
import { syncSystemSettingsToEnvFiles } from "../../system-settings/env-file";
import {
  getAdminSystemSettingsSnapshot,
  getSystemSettingValue,
  importSystemSettingsFromEnv,
  initializeMissingSystemSettingsDefaults,
  setSystemSettings,
} from "../../system-settings/index";
import { getPrincipalUserId } from "../principal";
import { defineOperation } from "../registry";

/**
 * settings.getSnapshot - 获取管理后台设置快照
 *
 * 返回当前所有系统设置的完整快照，供超级管理员在管理面板查看。
 * 纯读操作，不改变系统状态。
 */
export const settingsGetSnapshot = defineOperation({
  name: "settings.getSnapshot",
  domain: "system-settings",
  title: "Get Admin Settings Snapshot",
  description:
    "获取当前所有系统设置的完整快照，供超级管理员在管理面板查看与审计。",
  input: z.object({}),
  output: z.object({
    settings: z.record(z.string(), z.unknown()),
    timestamp: z.string(),
  }),
  access: { kind: "superAdmin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async (_input, _principal, _ctx) => {
    const snapshot = await getAdminSystemSettingsSnapshot();
    const settings: Record<string, unknown> = {};
    for (const item of snapshot) {
      settings[item.key] = item.value;
    }
    return {
      settings,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * settings.update - 更新系统设置
 *
 * 超级管理员通过管理面板修改系统设置项。
 * 写操作，可能触发缓存刷新。
 */
export const settingsUpdate = defineOperation({
  name: "settings.update",
  domain: "system-settings",
  title: "Update System Settings",
  description: "超级管理员更新系统设置项（如站点名称、功能开关、限额等）。",
  input: z.object({
    updates: z.record(z.string(), z.unknown()),
  }),
  output: z.object({
    success: z.boolean(),
    updatedKeys: z.array(z.string()),
  }),
  access: { kind: "superAdmin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["cache"],
  execute: async (input, principal, _ctx) => {
    const userId = getPrincipalUserId(principal) ?? "system";
    const entries = Object.entries(input.updates).map(([key, value]) => ({
      key,
      value,
    }));
    const updatedKeys = await setSystemSettings(entries, userId);

    // 启用"按最大张数"清理时立即后台执行一次，与 server action 行为一致（共用谓词）。
    // WHY: fire-and-forget + catch 记日志，不阻塞 operation 返回；清理函数默认全量
    // 扫描，幂等 WHERE 保证其与定时任务并发安全。
    if (
      shouldRunMaxCountCleanupOnSettingsChange(
        updatedKeys,
        input.updates.GENERATION_IMAGE_RETENTION_MODE
      )
    ) {
      void destroyGenerationPhotosByMaxCount().catch((error) => {
        logError(error, {
          source: "uol.settings-update.enable-max-count-cleanup",
        });
      });
    }

    return {
      success: true,
      updatedKeys,
    };
  },
});

/**
 * settings.importFromEnv - 从环境变量导入设置
 *
 * 将当前进程环境变量中的设置值导入数据库，用于初始部署或迁移场景。
 * 仅超级管理员或系统身份可调用。
 */
export const settingsImportFromEnv = defineOperation({
  name: "settings.importFromEnv",
  domain: "system-settings",
  title: "Import Settings From Env",
  description:
    "从进程环境变量导入设置到数据库，用于初始部署或从 .env 迁移到 DB 存储。",
  input: z.object({
    overwriteExisting: z.boolean().optional(),
  }),
  output: z.object({
    importedCount: z.number(),
    skippedCount: z.number(),
    importedKeys: z.array(z.string()),
  }),
  access: { kind: "superAdmin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["cache"],
  hasMaintenanceWrite: true,
  execute: async (input, principal, _ctx) => {
    const userId = getPrincipalUserId(principal) ?? "system";
    const importedKeys = await importSystemSettingsFromEnv({
      updatedBy: userId,
      ...(input.overwriteExisting != null
        ? { overwrite: input.overwriteExisting }
        : {}),
    });
    return {
      importedCount: importedKeys.length,
      skippedCount: 0,
      importedKeys,
    };
  },
});

/**
 * settings.initializeDefaults - 初始化缺失的默认值
 *
 * 检查数据库中是否存在所有已定义的设置项，对缺失项写入默认值。
 * 通常在应用启动或升级后调用。仅超级管理员或系统身份。
 */
export const settingsInitializeDefaults = defineOperation({
  name: "settings.initializeDefaults",
  domain: "system-settings",
  title: "Initialize Missing Defaults",
  description:
    "检查并初始化数据库中缺失的设置项为默认值，用于应用启动或版本升级后补全配置。",
  input: z.object({}),
  output: z.object({
    initializedCount: z.number(),
    initializedKeys: z.array(z.string()),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["cache"],
  hasMaintenanceWrite: true,
  execute: async (_input, principal, _ctx) => {
    const userId = getPrincipalUserId(principal) ?? "system";
    const initializedKeys = await initializeMissingSystemSettingsDefaults({
      updatedBy: userId,
    });
    return {
      initializedCount: initializedKeys.length,
      initializedKeys,
    };
  },
});

/**
 * settings.syncToEnv - 同步设置到 .env 文件
 *
 * 将数据库中的设置同步写入 .env 文件，供非 DB 感知的子进程使用。
 * 仅系统身份可调用（通常由启动脚本触发）。
 */
export const settingsSyncToEnv = defineOperation({
  name: "settings.syncToEnv",
  domain: "system-settings",
  title: "Sync Settings To Env Files",
  description:
    "将数据库中的系统设置同步写入 .env 文件，供非数据库感知的子进程读取。",
  input: z.object({
    targetPath: z.string().optional(),
  }),
  output: z.object({
    syncedCount: z.number(),
    filePath: z.string(),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["external-call"],
  processLocalState: true,
  execute: async (input, _principal, _ctx) => {
    const result = await syncSystemSettingsToEnvFiles();
    return {
      syncedCount: result.files.length,
      filePath: input.targetPath ?? result.files[0] ?? "",
    };
  },
});

/**
 * settings.bootstrap - 引导启动时的设置环境
 *
 * 应用冷启动时的一次性设置引导：从 .env 加载到内存缓存，
 * 确保后续读取无需每次访问数据库。仅系统身份（进程内部调用）。
 */
export const settingsBootstrap = defineOperation({
  name: "settings.bootstrap",
  domain: "system-settings",
  title: "Bootstrap Settings Env",
  description:
    "应用冷启动时引导设置环境：从 .env/DB 加载到进程内存缓存，确保运行时读取高效。",
  input: z.object({}),
  output: z.object({
    loadedCount: z.number(),
    source: z.enum(["database", "env", "hybrid"]),
  }),
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["cache"],
  processLocalState: true,
  execute: async (_input, _principal, _ctx) => {
    await bootstrapSystemSettingsEnv();
    return {
      loadedCount: 0,
      source: "hybrid" as const,
    };
  },
});

/**
 * settings.getValue - 获取单个运行时设置值
 *
 * 通用 getter，系统/内部调用以获取指定 key 的当前有效值。
 * 优先从内存缓存返回，缓存未命中则回落数据库。
 */
export const settingsGetValue = defineOperation({
  name: "settings.getValue",
  domain: "system-settings",
  title: "Get Runtime Setting Value",
  description:
    "获取指定 key 的当前运行时设置值，优先从内存缓存返回，缓存未命中回落数据库。",
  input: z.object({
    key: z.string(),
  }),
  output: z.object({
    key: z.string(),
    value: z.unknown(),
    source: z.enum(["cache", "database", "default"]),
  }),
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  processLocalState: true,
  execute: async (input, _principal, _ctx) => {
    // 尝试从 DB 缓存获取值，未命中则回落环境变量
    const dbValue = await getSystemSettingValue(
      input.key as Parameters<typeof getSystemSettingValue>[0]
    );
    if (dbValue !== undefined) {
      return {
        key: input.key,
        value: dbValue,
        source: "cache" as const,
      };
    }
    const envValue = process.env[input.key]?.trim() || undefined;
    if (envValue !== undefined) {
      return {
        key: input.key,
        value: envValue,
        source: "database" as const,
      };
    }
    return {
      key: input.key,
      value: undefined,
      source: "default" as const,
    };
  },
});
