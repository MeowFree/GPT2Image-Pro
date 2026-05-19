"use server";

import { z } from "zod";

import { adminAction, protectedAction } from "@repo/shared/safe-action";

import {
  deleteImageBackendGroup,
  deleteImageBackendMembers,
  fromSafetyOverride,
  getUserImageBackendPreference,
  listAdminImageBackendPool,
  listImageBackendGroupOptions,
  listSelectableImageBackendGroups,
  listSub2ApiSourceGroups,
  refreshImageBackendAccountInfo,
  setUserImageBackendPreference,
  syncImageBackendAccountsFromSub2Api,
  upsertImageBackendAccount,
  upsertImageBackendApi,
  upsertImageBackendGroup,
} from "./service";

const nullableGroupIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== "default" ? value : null));

const safetyOverrideSchema = z.enum(["inherit", "enabled", "disabled"]);
const accountBackendSchema = z.enum(["web", "responses"]);
const sub2ApiTokenSyncModeSchema = z.enum(["web", "responses", "both"]);

const withImageBackendPoolAdminAction = (name: string) =>
  adminAction.metadata({ action: `imageBackendPool.${name}` });

export const getSelectableImageBackendGroupsAction = protectedAction
  .metadata({ action: "imageBackendPool.selectableGroups" })
  .action(async ({ ctx }) => {
    const [groups, selectedGroupId] = await Promise.all([
      listSelectableImageBackendGroups(),
      getUserImageBackendPreference(ctx.userId),
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
    await setUserImageBackendPreference(ctx.userId, parsedInput.groupId);
    return { success: true };
  });

export const getAdminImageBackendPoolAction =
  withImageBackendPoolAdminAction("list").action(async () => {
    const pool = await listAdminImageBackendPool();
    return pool;
  });

export const getSub2ApiSourceGroupsAction =
  withImageBackendPoolAdminAction("sub2ApiSourceGroups").action(async () => {
    const groups = await listSub2ApiSourceGroups();
    return { groups };
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
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().max(200).optional(),
      accessToken: z.string().trim().optional(),
      refreshToken: z.string().trim().optional(),
      implementationMode: accountBackendSchema.default("web"),
      model: z.string().trim().max(120).optional(),
      contentSafetyEnabled: z.boolean().default(true),
      isEnabled: z.boolean().default(true),
      priority: z.coerce.number().int().min(0).max(10000).default(50),
      concurrency: z.coerce.number().int().min(1).max(100).default(1),
      status: z.string().trim().max(80).optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendAccount({
      id: parsedInput.id,
      groupId: parsedInput.groupId,
      name: parsedInput.name,
      email: parsedInput.email || null,
      accessToken: parsedInput.accessToken || undefined,
      refreshToken: parsedInput.refreshToken || null,
      implementationMode: parsedInput.implementationMode,
      model: parsedInput.model || null,
      contentSafetyEnabled: parsedInput.contentSafetyEnabled,
      isEnabled: parsedInput.isEnabled,
      priority: parsedInput.priority,
      concurrency: parsedInput.concurrency,
      status: parsedInput.status || "active",
    });
    return { success: true, id };
  });

export const syncImageBackendAccountsFromSub2ApiAction =
  withImageBackendPoolAdminAction("syncSub2ApiAccounts")
    .schema(
      z.object({
        webGroupId: nullableGroupIdSchema,
        responsesGroupId: nullableGroupIdSchema,
        sourceGroupId: nullableGroupIdSchema,
        syncMode: sub2ApiTokenSyncModeSchema.default("both"),
        contentSafetyEnabled: z.boolean().default(true),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
    )
    .action(async ({ parsedInput }) => {
      const result = await syncImageBackendAccountsFromSub2Api({
        webGroupId: parsedInput.webGroupId,
        responsesGroupId: parsedInput.responsesGroupId,
        sourceGroupId: parsedInput.sourceGroupId,
        syncMode: parsedInput.syncMode,
        contentSafetyEnabled: parsedInput.contentSafetyEnabled,
        limit: parsedInput.limit,
      });
      return { success: true, ...result };
    });

export const saveImageBackendApiAction = withImageBackendPoolAdminAction(
  "saveApi"
)
  .schema(
    z.object({
      id: z.string().trim().optional(),
      groupId: nullableGroupIdSchema,
      name: z.string().trim().min(1).max(120),
      baseUrl: z.string().trim().url(),
      apiKey: z.string().trim().optional(),
      model: z.string().trim().max(120).optional(),
      useStream: z.boolean().default(false),
      contentSafetyEnabled: z.boolean().default(true),
      isEnabled: z.boolean().default(true),
      priority: z.coerce.number().int().min(0).max(10000).default(50),
      status: z.string().trim().max(80).optional(),
    })
  )
  .action(async ({ parsedInput }) => {
    const id = await upsertImageBackendApi({
      id: parsedInput.id,
      groupId: parsedInput.groupId,
      name: parsedInput.name,
      baseUrl: parsedInput.baseUrl,
      apiKey: parsedInput.apiKey || undefined,
      model: parsedInput.model || null,
      useStream: parsedInput.useStream,
      contentSafetyEnabled: parsedInput.contentSafetyEnabled,
      isEnabled: parsedInput.isEnabled,
      priority: parsedInput.priority,
      status: parsedInput.status || "active",
    });
    return { success: true, id };
  });

export const deleteImageBackendMemberAction =
  withImageBackendPoolAdminAction("deleteMember")
    .schema(
      z.object({
        type: z.enum(["account", "api"]),
        id: z.string().trim().min(1),
      })
    )
    .action(async ({ parsedInput }) => {
      await deleteImageBackendMembers(
        parsedInput.type === "account"
          ? { accountIds: [parsedInput.id] }
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

export const getImageBackendGroupOptionsAction = protectedAction
  .metadata({ action: "imageBackendPool.groupOptions" })
  .action(async () => {
    const groups = await listImageBackendGroupOptions();
    return { groups };
  });
