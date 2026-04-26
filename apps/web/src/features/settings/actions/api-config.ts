"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
import { protectedAction } from "@repo/shared/safe-action";

const apiConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().optional(),
});

const withApiConfigAction = (name: string) =>
  protectedAction.metadata({ action: `settings.apiConfig.${name}` });

export const getApiConfig = withApiConfigAction("get").action(
  async ({ ctx }) => {
    const config = await db
      .select()
      .from(userApiConfig)
      .where(eq(userApiConfig.userId, ctx.userId))
      .limit(1);
    return config[0] || null;
  }
);

export const saveApiConfig = withApiConfigAction("save")
  .schema(apiConfigSchema)
  .action(async ({ parsedInput, ctx }) => {
    const existing = await db
      .select()
      .from(userApiConfig)
      .where(eq(userApiConfig.userId, ctx.userId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(userApiConfig)
        .set({
          baseUrl: parsedInput.baseUrl,
          apiKey: parsedInput.apiKey,
          model: parsedInput.model || null,
          updatedAt: new Date(),
        })
        .where(eq(userApiConfig.userId, ctx.userId));
    } else {
      await db.insert(userApiConfig).values({
        id: nanoid(),
        userId: ctx.userId,
        baseUrl: parsedInput.baseUrl,
        apiKey: parsedInput.apiKey,
        model: parsedInput.model || null,
      });
    }

    return { success: true };
  });

export const deleteApiConfig = withApiConfigAction("delete").action(
  async ({ ctx }) => {
    await db.delete(userApiConfig).where(eq(userApiConfig.userId, ctx.userId));
    return { success: true };
  }
);

export const toggleApiConfig = withApiConfigAction("toggle")
  .schema(z.object({ isActive: z.boolean() }))
  .action(async ({ parsedInput, ctx }) => {
    await db
      .update(userApiConfig)
      .set({
        isActive: parsedInput.isActive,
        updatedAt: new Date(),
      })
      .where(eq(userApiConfig.userId, ctx.userId));
    return { success: true };
  });
