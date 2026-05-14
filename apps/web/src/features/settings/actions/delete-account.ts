"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db, user } from "@repo/database";
import {
  account,
  registrationIdentity,
  session,
  subscription,
} from "@repo/database/schema";
import { normalizeEmail } from "@repo/shared/auth/email-domain";
import { creem } from "@repo/shared/payment/creem";
import { protectedAction } from "@repo/shared/safe-action";

export const deleteAccountAction = protectedAction
  .metadata({ action: "settings.deleteAccount" })
  .action(async ({ ctx }) => {
    const [activeSubscription] = await db
      .select({
        subscriptionId: subscription.subscriptionId,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      })
      .from(subscription)
      .where(eq(subscription.userId, ctx.userId))
      .limit(1);

    if (
      activeSubscription?.subscriptionId &&
      !activeSubscription.cancelAtPeriodEnd &&
      ["active", "trialing", "past_due", "paused"].includes(
        activeSubscription.status
      )
    ) {
      await creem.cancelSubscription(activeSubscription.subscriptionId);
    }

    const [existingUser] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, ctx.userId))
      .limit(1);

    if (!existingUser) {
      throw new Error("删除账户失败，请稍后重试");
    }

    const normalizedEmail = normalizeEmail(existingUser.email);

    const [deletedUser] = await db.transaction(async (tx) => {
      const now = new Date();

      await tx
        .insert(registrationIdentity)
        .values({
          id: randomUUID(),
          email: normalizedEmail,
          userId: ctx.userId,
          firstRegisteredAt: now,
          lastSeenAt: now,
          deletedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: registrationIdentity.email,
          set: {
            userId: ctx.userId,
            lastSeenAt: now,
            deletedAt: now,
            updatedAt: now,
          },
        });

      await tx.delete(session).where(eq(session.userId, ctx.userId));
      await tx.delete(account).where(eq(account.userId, ctx.userId));

      return tx
        .update(user)
        .set({
          name: "Deleted User",
          image: null,
          customerId: null,
          banned: true,
          bannedReason: "account_deleted",
          updatedAt: now,
        })
        .where(eq(user.id, ctx.userId))
        .returning({ id: user.id });
    });

    if (!deletedUser) {
      throw new Error("删除账户失败，请稍后重试");
    }

    return {
      success: true,
      message: "账户已删除",
    };
  });
