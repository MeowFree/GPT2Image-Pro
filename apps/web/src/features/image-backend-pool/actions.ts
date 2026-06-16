"use server";

/**
 * 用户侧生图后端分组偏好 server actions
 *
 * 仅包含面向普通用户的操作（选择/保存分组偏好）。
 * 管理侧操作已迁移至 apps/admin。
 */

import { protectedAction } from "@repo/shared/safe-action";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import {
  getUserImageBackendPreference,
  listSelectableImageBackendGroups,
  setUserImageBackendPreference,
} from "@repo/image-generation/image-backend/service";
import { z } from "zod";

const nullableGroupIdSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value !== "default" ? value : null));

/**
 * 获取当前用户可选择的生图后端分组列表及已选分组
 *
 * 根据用户订阅计划过滤可见分组。
 */
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

/**
 * 保存用户的生图后端分组偏好
 *
 * groupId 为 "default" 或空时重置为平台默认分组。
 */
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
