"use server";

import { getUserRoleById } from "@repo/shared/auth/role-server";
import { isAdminRole } from "@repo/shared/auth/roles";
import { protectedAction } from "@repo/shared/safe-action";
import { setSystemSettings } from "@repo/shared/system-settings";
import { z } from "zod";

export const updateMarketingSlaStatusVisibilityAction = protectedAction
  .metadata({ action: "marketing.slaStatus.visibility" })
  .schema(z.object({ enabled: z.boolean() }))
  .action(async ({ parsedInput, ctx }) => {
    const role = await getUserRoleById(ctx.userId);
    if (!isAdminRole(role)) {
      throw new Error("此操作需要管理员权限");
    }

    await setSystemSettings(
      [
        {
          key: "MARKETING_SLA_STATUS_ENABLED",
          value: parsedInput.enabled,
        },
      ],
      ctx.userId
    );

    return {
      enabled: parsedInput.enabled,
      message: parsedInput.enabled ? "首页 SLA 已开启" : "首页 SLA 已关闭",
    };
  });
