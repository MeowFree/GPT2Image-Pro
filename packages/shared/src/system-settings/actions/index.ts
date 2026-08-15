"use server";

import { z } from "zod";

import {
  destroyGenerationPhotosByMaxCount,
  shouldRunMaxCountCleanupOnSettingsChange,
} from "../../generation-maintenance";
import { logError } from "../../logger";
import { superAdminAction } from "../../safe-action";
import { syncSystemSettingsToEnvFiles } from "../env-file";
import {
  getAdminSystemSettingsSnapshot,
  importSystemSettingsFromEnv,
  initializeMissingSystemSettingsDefaults,
  setSystemSettings,
} from "../index";

const settingUpdateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown().optional(),
  clear: z.boolean().optional(),
});

export const getSystemSettingsAction = superAdminAction
  .metadata({ action: "system-settings.get" })
  .action(async () => {
    const settings = await getAdminSystemSettingsSnapshot();
    return { settings };
  });

export const updateSystemSettingsAction = superAdminAction
  .metadata({ action: "system-settings.update" })
  .schema(
    z.object({
      settings: z.array(settingUpdateSchema).min(1),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const changedKeys = await setSystemSettings(
      parsedInput.settings.map((setting) => ({
        key: setting.key,
        value: setting.value,
        ...(setting.clear !== undefined ? { clear: setting.clear } : {}),
      })),
      ctx.userId
    );
    const envSync = await syncSystemSettingsToEnvFiles();

    // 启用"按最大张数"清理时立即后台执行一次（需求）。判定单点在 shared 纯谓词，
    // 与 UOL 写入口共用以保证行为一致。清空（回退默认）时传 undefined，不误判为启用。
    const modeEntry = parsedInput.settings.find(
      (setting) => setting.key === "GENERATION_IMAGE_RETENTION_MODE"
    );
    const newModeValue =
      modeEntry?.clear === true ? undefined : modeEntry?.value;

    if (shouldRunMaxCountCleanupOnSettingsChange(changedKeys, newModeValue)) {
      // WHY: 清理会删存储对象并扫描，耗时不可控，不能 await 阻塞保存响应（避免
      // server action 超时）。后台 fire-and-forget + 显式 catch 记日志，杜绝未处理
      // 的 promise 拒绝。清理函数默认全量扫描，幂等 WHERE 保证其与定时任务并发
      // 安全（deleteObject 幂等 + UPDATE 守卫）；失败对象由后续定时任务继续重试。
      void destroyGenerationPhotosByMaxCount().catch((error) => {
        logError(error, {
          source: "system-settings.enable-max-count-cleanup",
        });
      });
    }

    return {
      success: true,
      changedKeys,
      envFiles: envSync.files,
      message: "系统设置已保存",
    };
  });

export const importSystemSettingsFromEnvAction = superAdminAction
  .metadata({ action: "system-settings.importEnv" })
  .schema(z.object({ overwrite: z.boolean().optional() }).optional())
  .action(async ({ parsedInput, ctx }) => {
    const importedKeys = await importSystemSettingsFromEnv({
      updatedBy: ctx.userId,
      overwrite: parsedInput?.overwrite ?? true,
    });
    const envSync = await syncSystemSettingsToEnvFiles();

    return {
      success: true,
      importedKeys,
      envFiles: envSync.files,
      message:
        importedKeys.length > 0
          ? `已导入 ${importedKeys.length} 个环境变量配置`
          : "没有可导入的环境变量配置",
    };
  });

export const initializeSystemSettingsDefaultsAction = superAdminAction
  .metadata({ action: "system-settings.initializeDefaults" })
  .action(async ({ ctx }) => {
    const initializedKeys = await initializeMissingSystemSettingsDefaults({
      updatedBy: ctx.userId,
    });
    const envSync = await syncSystemSettingsToEnvFiles();

    return {
      success: true,
      initializedKeys,
      envFiles: envSync.files,
      message:
        initializedKeys.length > 0
          ? `已初始化 ${initializedKeys.length} 个默认配置`
          : "默认配置已存在，无需初始化",
    };
  });
