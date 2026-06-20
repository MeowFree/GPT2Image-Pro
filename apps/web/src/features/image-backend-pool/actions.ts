"use server";

import {
  isSubscriptionPlan,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";

import {
  adminAction,
  imageBackendPoolViewerAction,
  protectedAction,
} from "@repo/shared/safe-action";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { z } from "zod";

import {
  deleteAdobeAccount,
  importAdobeAccount,
  listAdobeAccounts,
  setAdobeAccountEnabled,
} from "@/features/image-generation/adobe-direct";

import {
  bulkUpdateImageBackendAccounts,
  deleteImageBackendGroup,
  deleteImageBackendMembers,
  deleteSub2ApiAutoSyncTask,
  fromSafetyOverride,
  getUserImageBackendPreference,
  importImageBackendAccountsFromRefreshTokens,
  importImageBackendWebAccountsFromAccessTokens,
  isSub2ApiPostgresConfigured,
  listAdminImageBackendPool,
  listImageBackendGroupOptions,
  listSelectableImageBackendGroups,
  listSub2ApiAutoSyncTasksForAdmin,
  listSub2ApiSourceGroups,
  probeImageBackendApi,
  readSub2ApiSyncProgress,
  refreshImageBackendAccountInfo,
  refreshImageBackendAccountsInfo,
  runSub2ApiAutoSyncTaskNow,
  runSub2ApiManualSync,
  setImageBackendAccountAlwaysActive,
  setImageBackendAdobeAlwaysActive,
  setImageBackendAdobeEnabled,
  setImageBackendApiAlwaysActive,
  setImageBackendApiEnabled,
  setSub2ApiAutoSyncTaskEnabled,
  setSub2ApiAutoSyncTaskOverwriteLocalUnavailableState,
  setUserImageBackendPreference,
  syncImageBackendAccountsFromSub2Api,
  updateSub2ApiAutoSyncTaskOptions,
  upsertImageBackendAccount,
  upsertImageBackendAdobe,
  upsertImageBackendApi,
  upsertImageBackendGroup,
} from "./service";

const nullableGroupIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== "default" ? value : null));

const optionalGroupIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value === undefined
      ? undefined
      : value && value !== "default"
        ? value
        : null
  );

const safetyOverrideSchema = z.enum(["inherit", "enabled", "disabled"]);
const accountBackendSchema = z.enum(["web", "responses"]);
const groupBackendTypeSchema = z.enum(["mixed", "web", "responses"]);
const apiInterfaceModeSchema = z.enum(["images", "responses", "mixed"]);
const chatCompletionsUpstreamModeSchema = z.enum([
  "responses",
  "chat_completions",
]);
const imagesUpstreamModeSchema = z.enum(["images", "responses"]);
const sub2ApiTokenSyncModeSchema = z.enum(["web", "responses", "both"]);
const sub2ApiPlanFilterSchema = z.enum([
  "all",
  "free",
  "plus",
  "pro",
  "non_free",
]);
const subscriptionPlanSchema = z
  .string()
  .trim()
  .optional()
  .transform(
    (value): SubscriptionPlan => (isSubscriptionPlan(value) ? value : "free")
  );

const withImageBackendPoolAdminAction = (name: string) =>
  adminAction.metadata({ action: `imageBackendPool.${name}` });

const withImageBackendPoolViewerAction = (name: string) =>
  imageBackendPoolViewerAction.metadata({ action: `imageBackendPool.${name}` });

export const getSelectableImageBackendGroupsAction = protectedAction
  .metadata({ action: "imageBackendPool.selectableGroups" })
  .action(async ({ ctx }) => {
    const plan = await getUserPlan(ctx.userId);
    const [groups, selectedGroupId] = await Promise.all([
      listSelectableImageBackendGroups(plan.plan),
      getUserImageBackendPreference(ctx.userId, plan.plan),
    ]);
    return { groups, selectedGroupId };
  });

export const setUserImageBackendPreferenceAction = protectedAction
  .metadata({ action: "imageBackendPool.setPreference" })
  .schema(
    z.object({
      groupId: nullableGroupIdSchema,
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const plan = await getUserPlan(ctx.userId);
    await setUserImageBackendPreference(
      ctx.userId,
      parsedInput.groupId,
      plan.plan
    );
    return { success: true };
  });

export const getAdminImageBackendPoolAction = withImageBackendPoolViewerAction(
  "list"
).action(async () => {
  const pool = await listAdminImageBackendPool();
  return pool;
});

export const getSub2ApiSyncStatusAction = withImageBackendPoolAdminAction(
  "sub2ApiSyncStatus"
).action(async () => {
  return {
    configured: await isSub2ApiPostgresConfigured(),
  };
});

// 全量同步进行中由前端轮询读取进度(进程内单槽,best-effort)。
export const getSub2ApiSyncProgressAction = withImageBackendPoolAdminAction(
  "sub2ApiSyncProgress"
).action(async () => {
  const progress = readSub2ApiSyncProgress();
  return { progress: progress ? { ...progress } : null };
});

export const getSub2ApiSourceGroupsAction = withImageBackendPoolAdminAction(
  "sub2ApiSourceGroups"
).action(async () => {
  const groups = await listSub2ApiSourceGroups();
  return { groups };
});

export const getSub2ApiAutoSyncTasksAction = withImageBackendPoolAdminAction(
  "sub2ApiAutoSyncTasks"
).action(async () => {
  const tasks = await listSub2ApiAutoSyncTasksForAdmin();
  return { tasks };
});

export const runSub2ApiAutoSyncTaskNowAction = withImageBackendPoolAdminAction(
  "runSub2ApiAutoSyncTaskNow"
)
  .schema(
    z.object({
      taskId: z.string().trim().min(1),
    })
  )
  .action(async ({ parsedInput }) => {
    return runSub2ApiAutoSyncTaskNow(parsedInput.taskId);
  });

export const setSub2ApiAutoSyncTaskEnabledAction =
  withImageBackendPoolAdminAction("setSub2ApiAutoSyncTaskEnabled")
    .schema(
      z.object({
        taskId: z.string().trim().min(1),
        enabled: z.boolean(),
      })
    )
    .action(async ({ parsedInput }) => {
      await setSub2ApiAutoSyncTaskEnabled(parsedInput);
      return { success: true };
    });

export const setSub2ApiAutoSyncTaskOverwriteLocalUnavailableStateAction =
  withImageBackendPoolAdminAction(
    "setSub2ApiAutoSyncTaskOverwriteLocalUnavailableState"
  )
    .schema(
      z.object({
        taskId: z.string().trim().min(1),
        overwriteLocalUnavailableState: z.boolean(),
      })
    )
    .action(async ({ parsedInput }) => {
      await setSub2ApiAutoSyncTaskOverwriteLocalUnavailableState(parsedInput);
      return { success: true };
    });

export const updateSub2ApiAutoSyncTaskOptionsAction =
  withImageBackendPoolAdminAction("updateSub2ApiAutoSyncTaskOptions")
    .schema(
      z.object({
        taskId: z.string().trim().min(1),
        enabled: z.boolean(),
        webGroupId: optionalGroupIdSchema,
        responsesGroupId: optionalGroupIdSchema,
        syncMode: sub2ApiTokenSyncModeSchema.default("responses"),
        allowMobileRtImport: z.boolean().default(false),
        contentSafetyEnabled: z.boolean().default(true),
        overwriteLocalUnavailableState: z.boolean().default(true),
        planFilter: sub2ApiPlanFilterSchema.default("non_free"),
        intervalMinutes: z.coerce.number().int().min(1).default(720),
      })
    )
    .action(async ({ parsedInput }) => {
      await updateSub2ApiAutoSyncTaskOptions(parsedInput);
      return { success: true };
    });

export const deleteSub2ApiAutoSyncTaskAction = withImageBackendPoolAdminAction(
  "deleteSub2ApiAutoSyncTask"
)
  .schema(
    z.object({
      taskId: z.string().trim().min(1),
    })
  )
  .action(async ({ parsedInput }) => {
    await deleteSub2ApiAutoSyncTask(parsedInput.taskId);
    return { success: true };
  });

export const saveImageBackendGroupAction = withImageBackendPoolAdminAction(
  "saveGroup"
)
  .schema(
    z.object({
      id: z.string().trim().optional(),
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500).optional(),
      isEnabled: z.boolean().default(true),
      isDefault: z.boolean().default(false),
      isUserSelectable: z.boolean().default(true),
      contentSafety: safetyOverrideSchema.default("inherit"),
      backendType: groupBackendTypeSchema.default("mixed"),
      minPlan: subscriptionPlanSchema,
      billingMultiplier: z.coerce.number().min(0.01).max(100).default(1),
      childGroupIds: z.array(z.string().trim().min(1)).max(100).default([]),
      priority: z.coerce.number().int().min(0).max(10000).default(50),
    })
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendGroup({
      id: parsedInput.id,
      name: parsedInput.name,
      description: parsedInput.description || null,
      isEnabled: parsedInput.isEnabled,
      isDefault: parsedInput.isDefault,
      isUserSelectable: parsedInput.isUserSelectable,
      contentSafetyEnabled: fromSafetyOverride(parsedInput.contentSafety),
      backendType: parsedInput.backendType,
      minPlan: parsedInput.minPlan,
      billingMultiplier: parsedInput.billingMultiplier,
      childGroupIds: parsedInput.childGroupIds,
      priority: parsedInput.priority,
    });
    return { success: true, id };
  });

export const deleteImageBackendGroupAction = withImageBackendPoolAdminAction(
  "deleteGroup"
)
  .schema(z.object({ id: z.string().trim().min(1) }))
  .action(async ({ parsedInput }) => {
    await deleteImageBackendGroup(parsedInput.id);
    return { success: true };
  });

export const saveImageBackendAccountAction = withImageBackendPoolAdminAction(
  "saveAccount"
)
  .schema(
    z.object({
      id: z.string().trim().optional(),
      groupId: nullableGroupIdSchema,
      groupIds: z.array(z.string().trim().min(1)).max(100).optional(),
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().max(200).optional(),
      accessToken: z.string().trim().optional(),
      refreshToken: z.string().trim().optional(),
      implementationMode: accountBackendSchema.default("web"),
      model: z.string().trim().max(120).optional(),
      contentSafetyEnabled: z.boolean().default(true),
      isEnabled: z.boolean().default(true),
      alwaysActive: z.boolean().default(false),
      priority: z.coerce.number().int().min(0).max(10000).default(50),
      concurrency: z.coerce.number().int().min(1).max(100).default(1),
      status: z.string().trim().max(80).optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendAccount({
      id: parsedInput.id,
      groupId: parsedInput.groupId,
      groupIds: parsedInput.groupIds,
      name: parsedInput.name,
      email: parsedInput.email || null,
      accessToken: parsedInput.accessToken || undefined,
      refreshToken: parsedInput.refreshToken || undefined,
      implementationMode: parsedInput.implementationMode,
      model: parsedInput.model || null,
      contentSafetyEnabled: parsedInput.contentSafetyEnabled,
      isEnabled: parsedInput.isEnabled,
      alwaysActive: parsedInput.alwaysActive,
      priority: parsedInput.priority,
      concurrency: parsedInput.concurrency,
      status: parsedInput.status || "active",
    });
    return { success: true, id };
  });

export const bulkUpdateImageBackendAccountsAction =
  withImageBackendPoolAdminAction("bulkUpdateAccounts")
    .schema(
      z.object({
        accountIds: z.array(z.string().trim().min(1)).min(1).max(10000),
        groupId: optionalGroupIdSchema,
        implementationMode: accountBackendSchema.optional(),
        contentSafetyEnabled: z.boolean().optional(),
        isEnabled: z.boolean().optional(),
        status: z.string().trim().max(80).optional(),
        resetAvailability: z.boolean().optional(),
        priority: z.coerce.number().int().min(0).max(10000).optional(),
        concurrency: z.coerce.number().int().min(1).max(100).optional(),
      })
    )
    .action(async ({ parsedInput }) => {
      const result = await bulkUpdateImageBackendAccounts({
        accountIds: parsedInput.accountIds,
        groupId: parsedInput.groupId,
        implementationMode: parsedInput.implementationMode || null,
        contentSafetyEnabled:
          parsedInput.contentSafetyEnabled === undefined
            ? null
            : parsedInput.contentSafetyEnabled,
        isEnabled:
          parsedInput.isEnabled === undefined ? null : parsedInput.isEnabled,
        status: parsedInput.status === undefined ? null : parsedInput.status,
        resetAvailability:
          parsedInput.resetAvailability === undefined
            ? null
            : parsedInput.resetAvailability,
        priority:
          parsedInput.priority === undefined ? null : parsedInput.priority,
        concurrency:
          parsedInput.concurrency === undefined
            ? null
            : parsedInput.concurrency,
      });
      return { success: true, ...result };
    });

export const bulkDeleteImageBackendAccountsAction =
  withImageBackendPoolAdminAction("bulkDeleteAccounts")
    .schema(
      z.object({
        accountIds: z.array(z.string().trim().min(1)).min(1).max(10000),
      })
    )
    .action(async ({ parsedInput }) => {
      const result = await deleteImageBackendMembers({
        accountIds: parsedInput.accountIds,
      });
      return {
        success: true,
        deletedCount: result.deletedAccountCount,
      };
    });

export const importImageBackendAccountsFromRefreshTokensAction =
  withImageBackendPoolAdminAction("importAccountsFromRefreshTokens")
    .schema(
      z.object({
        refreshTokensText: z.string().trim().min(1),
        webGroupId: nullableGroupIdSchema,
        responsesGroupId: nullableGroupIdSchema,
        syncMode: sub2ApiTokenSyncModeSchema.default("both"),
        useMobileRt: z.boolean().default(false),
        namePrefix: z.string().trim().max(80).optional(),
        model: z.string().trim().max(120).optional(),
        contentSafetyEnabled: z.boolean().default(true),
        priority: z.coerce.number().int().min(0).max(10000).default(50),
        concurrency: z.coerce.number().int().min(1).max(100).default(1),
        importBatchId: z.string().trim().min(1).max(128).optional(),
        startIndex: z.coerce.number().int().min(0).max(1_000_000).default(0),
      })
    )
    .action(async ({ parsedInput }) => {
      const result = await importImageBackendAccountsFromRefreshTokens({
        refreshTokensText: parsedInput.refreshTokensText,
        webGroupId: parsedInput.webGroupId,
        responsesGroupId: parsedInput.responsesGroupId,
        syncMode: parsedInput.syncMode,
        useMobileRt: parsedInput.useMobileRt,
        namePrefix: parsedInput.namePrefix || null,
        model: parsedInput.model || null,
        contentSafetyEnabled: parsedInput.contentSafetyEnabled,
        priority: parsedInput.priority,
        concurrency: parsedInput.concurrency,
        importBatchId: parsedInput.importBatchId,
        startIndex: parsedInput.startIndex,
      });
      return { success: true, ...result };
    });

export const importImageBackendWebAccountsFromAccessTokensAction =
  withImageBackendPoolAdminAction("importWebAccountsFromAccessTokens")
    .schema(
      z.object({
        accessTokensText: z.string().trim().min(1),
        webGroupId: nullableGroupIdSchema,
        namePrefix: z.string().trim().max(80).optional(),
        model: z.string().trim().max(120).optional(),
        contentSafetyEnabled: z.boolean().default(true),
        priority: z.coerce.number().int().min(0).max(10000).default(50),
        concurrency: z.coerce.number().int().min(1).max(100).default(1),
      })
    )
    .action(async ({ parsedInput }) => {
      const result = await importImageBackendWebAccountsFromAccessTokens({
        accessTokensText: parsedInput.accessTokensText,
        webGroupId: parsedInput.webGroupId,
        namePrefix: parsedInput.namePrefix || null,
        model: parsedInput.model || null,
        contentSafetyEnabled: parsedInput.contentSafetyEnabled,
        priority: parsedInput.priority,
        concurrency: parsedInput.concurrency,
      });
      return { success: true, ...result };
    });

export const syncImageBackendAccountsFromSub2ApiAction =
  withImageBackendPoolAdminAction("syncSub2ApiAccounts")
    .schema(
      z.object({
        webGroupId: nullableGroupIdSchema,
        responsesGroupId: nullableGroupIdSchema,
        sourceGroupId: nullableGroupIdSchema,
        sourceGroupName: z.string().trim().max(120).optional(),
        syncMode: sub2ApiTokenSyncModeSchema.default("responses"),
        allowMobileRtImport: z.boolean().default(false),
        contentSafetyEnabled: z.boolean().default(true),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        planFilter: sub2ApiPlanFilterSchema.default("non_free"),
        createSyncTask: z.boolean().default(false),
        overwriteLocalUnavailableState: z.boolean().default(true),
      })
    )
    .action(async ({ parsedInput }) => {
      const result = await syncImageBackendAccountsFromSub2Api({
        webGroupId: parsedInput.webGroupId,
        responsesGroupId: parsedInput.responsesGroupId,
        sourceGroupId: parsedInput.sourceGroupId,
        sourceGroupName: parsedInput.sourceGroupName || null,
        syncMode: parsedInput.allowMobileRtImport
          ? parsedInput.syncMode
          : "responses",
        allowMobileRtImport: parsedInput.allowMobileRtImport,
        contentSafetyEnabled: parsedInput.contentSafetyEnabled,
        limit: parsedInput.limit,
        offset: parsedInput.offset,
        planFilter: parsedInput.planFilter,
        createSyncTask: parsedInput.createSyncTask,
        cleanupManagedAccounts: parsedInput.createSyncTask,
        overwriteLocalUnavailableState:
          parsedInput.overwriteLocalUnavailableState,
      });
      return { success: true, ...result };
    });

export const runSub2ApiManualSyncAction = withImageBackendPoolAdminAction(
  "runSub2ApiManualSync"
)
  .schema(
    z.object({
      webGroupId: nullableGroupIdSchema,
      responsesGroupId: nullableGroupIdSchema,
      sourceGroupId: nullableGroupIdSchema,
      sourceGroupName: z.string().trim().max(120).optional(),
      syncMode: sub2ApiTokenSyncModeSchema.default("responses"),
      allowMobileRtImport: z.boolean().default(false),
      contentSafetyEnabled: z.boolean().default(true),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      planFilter: sub2ApiPlanFilterSchema.default("non_free"),
      createSyncTask: z.boolean().default(true),
      overwriteLocalUnavailableState: z.boolean().default(true),
      intervalMinutes: z.coerce.number().int().min(1).default(720),
    })
  )
  .action(async ({ parsedInput }) => {
    const result = await runSub2ApiManualSync({
      webGroupId: parsedInput.webGroupId,
      responsesGroupId: parsedInput.responsesGroupId,
      sourceGroupId: parsedInput.sourceGroupId,
      sourceGroupName: parsedInput.sourceGroupName || null,
      syncMode: parsedInput.allowMobileRtImport
        ? parsedInput.syncMode
        : "responses",
      allowMobileRtImport: parsedInput.allowMobileRtImport,
      contentSafetyEnabled: parsedInput.contentSafetyEnabled,
      limit: parsedInput.limit,
      planFilter: parsedInput.planFilter,
      createSyncTask: parsedInput.createSyncTask,
      overwriteLocalUnavailableState:
        parsedInput.overwriteLocalUnavailableState,
      intervalMinutes: parsedInput.intervalMinutes,
    });
    return result;
  });

export const saveImageBackendApiAction = withImageBackendPoolAdminAction(
  "saveApi"
)
  .schema(
    z.object({
      id: z.string().trim().optional(),
      groupId: nullableGroupIdSchema,
      groupIds: z.array(z.string().trim().min(1)).max(100).optional(),
      name: z.string().trim().min(1).max(120),
      baseUrl: z.string().trim().url(),
      apiKey: z.string().trim().optional(),
      model: z.string().trim().max(120).optional(),
      interfaceMode: apiInterfaceModeSchema.default("mixed"),
      chatCompletionsUpstreamMode:
        chatCompletionsUpstreamModeSchema.default("responses"),
      imagesUpstreamMode: imagesUpstreamModeSchema.default("images"),
      useStream: z.boolean().default(false),
      contentSafetyEnabled: z.boolean().default(true),
      isEnabled: z.boolean().default(true),
      alwaysActive: z.boolean().default(false),
      failureCooldownEnabled: z.boolean().default(false),
      priority: z.coerce.number().int().min(0).max(10000).default(50),
      concurrency: z.coerce.number().int().min(1).max(10000).default(10),
      status: z.string().trim().max(80).optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendApi({
      id: parsedInput.id,
      groupId: parsedInput.groupId,
      groupIds: parsedInput.groupIds,
      name: parsedInput.name,
      baseUrl: parsedInput.baseUrl,
      apiKey: parsedInput.apiKey || undefined,
      model: parsedInput.model || null,
      interfaceMode: parsedInput.interfaceMode,
      chatCompletionsUpstreamMode: parsedInput.chatCompletionsUpstreamMode,
      imagesUpstreamMode: parsedInput.imagesUpstreamMode,
      useStream: parsedInput.useStream,
      contentSafetyEnabled: parsedInput.contentSafetyEnabled,
      isEnabled: parsedInput.isEnabled,
      alwaysActive: parsedInput.alwaysActive,
      failureCooldownEnabled: parsedInput.failureCooldownEnabled,
      priority: parsedInput.priority,
      concurrency: parsedInput.concurrency,
      status: parsedInput.status || "active",
    });
    return { success: true, id };
  });

export const saveImageBackendAdobeAction = withImageBackendPoolAdminAction(
  "saveAdobe"
)
  .schema(
    z
      .object({
        id: z.string().trim().optional(),
        groupId: nullableGroupIdSchema,
        groupIds: z.array(z.string().trim().min(1)).max(100).optional(),
        name: z.string().trim().min(1).max(120),
        mode: z.enum(["gateway", "direct"]).default("gateway"),
        baseUrl: z.string().trim().default(""),
        apiKey: z.string().trim().optional(),
        enabledModels: z
          .array(z.string().trim().min(1).max(60))
          .max(20)
          .optional(),
        defaultRatio: z.string().trim().max(20).default("1x1"),
        defaultResolution: z.string().trim().max(10).default("2k"),
        supportsVideo: z.boolean().default(false),
        contentSafetyEnabled: z.boolean().default(true),
        isEnabled: z.boolean().default(true),
        alwaysActive: z.boolean().default(false),
        failureCooldownEnabled: z.boolean().default(false),
        priority: z.coerce.number().int().min(0).max(10000).default(50),
        concurrency: z.coerce.number().int().min(1).max(10000).default(10),
        status: z.string().trim().max(80).optional(),
      })
      // gateway 模式必须有合法 baseUrl；direct 模式凭据走 Adobe 账号（另表），baseUrl 可空。
      .refine(
        (value) =>
          value.mode === "direct" || /^https?:\/\//i.test(value.baseUrl),
        { message: "baseUrl must be a valid URL", path: ["baseUrl"] }
      )
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendAdobe({
      id: parsedInput.id,
      groupId: parsedInput.groupId,
      groupIds: parsedInput.groupIds,
      name: parsedInput.name,
      mode: parsedInput.mode,
      baseUrl: parsedInput.baseUrl,
      apiKey: parsedInput.apiKey || undefined,
      enabledModels: parsedInput.enabledModels ?? null,
      defaultRatio: parsedInput.defaultRatio,
      defaultResolution: parsedInput.defaultResolution,
      supportsVideo: parsedInput.supportsVideo,
      contentSafetyEnabled: parsedInput.contentSafetyEnabled,
      isEnabled: parsedInput.isEnabled,
      alwaysActive: parsedInput.alwaysActive,
      failureCooldownEnabled: parsedInput.failureCooldownEnabled,
      priority: parsedInput.priority,
      concurrency: parsedInput.concurrency,
      status: parsedInput.status || "active",
    });
    return { success: true, id };
  });

export const setImageBackendAdobeEnabledAction =
  withImageBackendPoolAdminAction("setAdobeEnabled")
    .schema(z.object({ id: z.string().trim().min(1), isEnabled: z.boolean() }))
    .action(async ({ parsedInput }) => {
      await setImageBackendAdobeEnabled(parsedInput);
      return { success: true };
    });

export const setImageBackendAdobeAlwaysActiveAction =
  withImageBackendPoolAdminAction("setAdobeAlwaysActive")
    .schema(
      z.object({ id: z.string().trim().min(1), alwaysActive: z.boolean() })
    )
    .action(async ({ parsedInput }) => {
      await setImageBackendAdobeAlwaysActive(parsedInput);
      return { success: true };
    });

// ===== Adobe 直连账号管理（mode=direct）=====

export const listAdobeAccountsAction = withImageBackendPoolAdminAction(
  "listAdobeAccounts"
)
  .schema(z.object({ adobeId: z.string().trim().min(1) }))
  .action(async ({ parsedInput }) => {
    const accounts = await listAdobeAccounts(parsedInput.adobeId);
    return { success: true, accounts };
  });

export const importAdobeAccountAction = withImageBackendPoolAdminAction(
  "importAdobeAccount"
)
  .schema(
    z.object({
      adobeId: z.string().trim().min(1),
      name: z.string().trim().max(120).optional(),
      cookie: z.string().trim().min(1),
      scope: z.string().trim().max(2000).optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const account = await importAdobeAccount({
      adobeId: parsedInput.adobeId,
      name: parsedInput.name,
      cookie: parsedInput.cookie,
      scope: parsedInput.scope ?? null,
    });
    return { success: true, account };
  });

export const deleteAdobeAccountAction = withImageBackendPoolAdminAction(
  "deleteAdobeAccount"
)
  .schema(z.object({ id: z.string().trim().min(1) }))
  .action(async ({ parsedInput }) => {
    await deleteAdobeAccount(parsedInput.id);
    return { success: true };
  });

export const setAdobeAccountEnabledAction = withImageBackendPoolAdminAction(
  "setAdobeAccountEnabled"
)
  .schema(z.object({ id: z.string().trim().min(1), isEnabled: z.boolean() }))
  .action(async ({ parsedInput }) => {
    await setAdobeAccountEnabled(parsedInput.id, parsedInput.isEnabled);
    return { success: true };
  });

export const setImageBackendApiEnabledAction = withImageBackendPoolAdminAction(
  "setApiEnabled"
)
  .schema(
    z.object({
      id: z.string().trim().min(1),
      isEnabled: z.boolean(),
    })
  )
  .action(async ({ parsedInput }) => {
    await setImageBackendApiEnabled(parsedInput);
    return { success: true };
  });

export const setImageBackendApiAlwaysActiveAction =
  withImageBackendPoolAdminAction("setApiAlwaysActive")
    .schema(
      z.object({
        id: z.string().trim().min(1),
        alwaysActive: z.boolean(),
      })
    )
    .action(async ({ parsedInput }) => {
      await setImageBackendApiAlwaysActive(parsedInput);
      return { success: true };
    });

export const setImageBackendAccountAlwaysActiveAction =
  withImageBackendPoolAdminAction("setAccountAlwaysActive")
    .schema(
      z.object({
        id: z.string().trim().min(1),
        alwaysActive: z.boolean(),
      })
    )
    .action(async ({ parsedInput }) => {
      await setImageBackendAccountAlwaysActive(parsedInput);
      return { success: true };
    });

export const testImageBackendApiAction = withImageBackendPoolAdminAction(
  "testApi"
)
  .schema(z.object({ id: z.string().trim().min(1) }))
  .action(async ({ parsedInput }) => {
    const probe = await probeImageBackendApi(parsedInput.id);
    return { success: true, ...probe };
  });

export const deleteImageBackendMemberAction = withImageBackendPoolAdminAction(
  "deleteMember"
)
  .schema(
    z.object({
      type: z.enum(["account", "api", "adobe"]),
      id: z.string().trim().min(1),
    })
  )
  .action(async ({ parsedInput }) => {
    await deleteImageBackendMembers(
      parsedInput.type === "account"
        ? { accountIds: [parsedInput.id] }
        : parsedInput.type === "adobe"
          ? { adobeIds: [parsedInput.id] }
          : { apiIds: [parsedInput.id] }
    );
    return { success: true };
  });

export const refreshImageBackendAccountInfoAction =
  withImageBackendPoolAdminAction("refreshAccountInfo")
    .schema(z.object({ id: z.string().trim().min(1) }))
    .action(async ({ parsedInput }) => {
      const info = await refreshImageBackendAccountInfo(parsedInput.id);
      return { success: true, info };
    });

export const refreshImageBackendAccountsInfoAction =
  withImageBackendPoolAdminAction("refreshAccountsInfo")
    .schema(
      z.object({
        accountIds: z.array(z.string().trim().min(1)).min(1).max(10000),
      })
    )
    .action(async ({ parsedInput }) => {
      const result = await refreshImageBackendAccountsInfo(
        parsedInput.accountIds
      );
      return { success: true, ...result };
    });

export const getImageBackendGroupOptionsAction = protectedAction
  .metadata({ action: "imageBackendPool.groupOptions" })
  .action(async () => {
    const groups = await listImageBackendGroupOptions();
    return { groups };
  });
