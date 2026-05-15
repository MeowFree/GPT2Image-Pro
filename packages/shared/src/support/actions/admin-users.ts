"use server";

import { eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@repo/database";
import { creditsBalance, subscription, user } from "@repo/database/schema";
import { CREDITS_EXPIRY_DAYS } from "../../credits/config";
import { grantCredits } from "../../credits/core";
import { adminAction } from "../../safe-action";

const withAdminUsersAction = (name: string) =>
  adminAction.metadata({ action: `support.adminUsers.${name}` });

/**
 * 更新用户角色 Schema
 */
const updateUserRoleSchema = z.object({
  userId: z.string().min(1, "用户ID不能为空"),
  role: z.enum(["user", "admin"]),
});

/**
 * 封禁/解封用户 Schema
 */
const banUserSchema = z.object({
  userId: z.string().min(1, "用户ID不能为空"),
  banned: z.boolean(),
  reason: z.string().optional(),
});

/**
 * 手动充值积分 Schema
 */
const grantCreditsSchema = z.object({
  userId: z.string().min(1, "用户ID不能为空"),
  amount: z
    .number()
    .positive("积分数量必须大于0")
    .max(100000, "单次最多充值10万积分"),
  reason: z.string().min(1, "请填写充值原因").max(200, "原因最多200字符"),
});

/**
 * 搜索用户 Schema
 */
const searchUsersSchema = z.object({
  query: z.string().optional(),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});

/**
 * 获取所有用户列表 (管理员) - 增强版
 *
 * 包含积分余额和订阅状态
 */
export const getAllUsersAction = withAdminUsersAction("getAllUsers")
  .schema(searchUsersSchema.optional())
  .action(async ({ parsedInput }) => {
    const query = parsedInput?.query;

    // 构建用户选择字段
    const userSelectFields = {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      banned: user.banned,
      bannedReason: user.bannedReason,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };

    // 根据是否有搜索条件构建查询
    const users =
      query && query.trim()
        ? await db
            .select(userSelectFields)
            .from(user)
            .where(
              or(
                ilike(user.name, `%${query}%`),
                ilike(user.email, `%${query}%`)
              )
            )
            .orderBy(user.createdAt)
        : await db
            .select(userSelectFields)
            .from(user)
            .orderBy(user.createdAt);

    // 获取所有用户的积分余额和订阅信息
    const userIds = users.map((u) => u.id);

    // 批量获取积分余额
    const balances =
      userIds.length > 0
        ? await db.select().from(creditsBalance).where(
            // biome-ignore lint: drizzle pattern
            or(...userIds.map((id) => eq(creditsBalance.userId, id)))
          )
        : [];

    // 批量获取订阅状态
    const subscriptions =
      userIds.length > 0
        ? await db.select().from(subscription).where(
            // biome-ignore lint: drizzle pattern
            or(...userIds.map((id) => eq(subscription.userId, id)))
          )
        : [];

    // 合并数据
    const enrichedUsers = users.map((u) => {
      const balance = balances.find((b) => b.userId === u.id);
      const sub = subscriptions.find((s) => s.userId === u.id);

      return {
        ...u,
        creditsBalance: balance?.balance ?? 0,
        subscriptionStatus: sub?.status ?? null,
        subscriptionPriceId: sub?.priceId ?? null,
      };
    });

    return { users: enrichedUsers };
  });

/**
 * 获取用户详情 (管理员)
 */
export const getUserDetailAction = withAdminUsersAction("getUserDetail")
  .schema(z.object({ userId: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const [userData] = await db
      .select()
      .from(user)
      .where(eq(user.id, parsedInput.userId))
      .limit(1);

    if (!userData) {
      throw new Error("用户不存在");
    }

    // 获取积分余额
    const [balance] = await db
      .select()
      .from(creditsBalance)
      .where(eq(creditsBalance.userId, parsedInput.userId))
      .limit(1);

    // 获取订阅状态
    const [sub] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, parsedInput.userId))
      .limit(1);

    return {
      user: userData,
      creditsBalance: balance?.balance ?? 0,
      creditsStatus: balance?.status ?? "active",
      subscription: sub ?? null,
    };
  });

/**
 * 更新用户角色 (管理员)
 */
export const updateUserRoleAction = withAdminUsersAction("updateUserRole")
  .schema(updateUserRoleSchema)
  .action(async ({ parsedInput: data }) => {
    await db
      .update(user)
      .set({
        role: data.role,
        updatedAt: new Date(),
      })
      .where(eq(user.id, data.userId));

    revalidatePath("/dashboard/users");
    return { message: `用户角色已更新为 ${data.role}` };
  });

/**
 * 封禁/解封用户 (管理员)
 */
export const banUserAction = withAdminUsersAction("banUser")
  .schema(banUserSchema)
  .action(async ({ parsedInput: data }) => {
    await db
      .update(user)
      .set({
        banned: data.banned,
        bannedReason: data.banned ? (data.reason ?? "管理员操作") : null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, data.userId));

    revalidatePath("/dashboard/users");
    return {
      message: data.banned ? "用户已被封禁" : "用户已被解封",
    };
  });

/**
 * 手动充值积分 (管理员)
 */
export const adminGrantCreditsAction = withAdminUsersAction("grantCredits")
  .schema(grantCreditsSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    const expiresAt = CREDITS_EXPIRY_DAYS
      ? new Date(Date.now() + CREDITS_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      : null;

    const result = await grantCredits({
      userId: data.userId,
      amount: data.amount,
      sourceType: "bonus",
      debitAccount: `ADMIN:${ctx.userId}`,
      transactionType: "admin_grant",
      expiresAt,
      description: `管理员手动充值: ${data.reason}`,
      metadata: {
        adminUserId: ctx.userId,
        reason: data.reason,
      },
    });

    revalidatePath("/dashboard/users");
    return {
      message: `已为用户充值 ${data.amount} 积分`,
      ...result,
    };
  });
