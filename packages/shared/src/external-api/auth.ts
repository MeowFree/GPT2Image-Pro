import { db } from "@repo/database";
import { externalApiKey, user } from "@repo/database/schema";
import {
  isModerationBlockRiskLevel,
  type ModerationBlockRiskLevel,
} from "@repo/shared/config/subscription-plan";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { and, eq } from "drizzle-orm";

import { getBearerToken, hashApiKey, safeEqual } from "./auth-token";

export async function authenticateExternalApiRequest(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const keyHash = hashApiKey(token);
  const keys = await db
    .select({
      id: externalApiKey.id,
      userId: externalApiKey.userId,
      keyHash: externalApiKey.keyHash,
      moderationBlockRiskLevel: externalApiKey.moderationBlockRiskLevel,
      creditLimit: externalApiKey.creditLimit,
      creditsUsed: externalApiKey.creditsUsed,
      relayOnly: externalApiKey.relayOnly,
      userBanned: user.banned,
    })
    .from(externalApiKey)
    .innerJoin(user, eq(user.id, externalApiKey.userId))
    .where(
      and(eq(externalApiKey.keyHash, keyHash), eq(externalApiKey.isActive, true))
    )
    .limit(1);

  const apiKey = keys[0];
  if (!apiKey || apiKey.userBanned || !safeEqual(keyHash, apiKey.keyHash)) {
    return null;
  }

  const plan = await getUserPlan(apiKey.userId);

  // 请求期复核纯中转权限：套餐降级后立即失效（不依赖降级钩子重置 DB 列）。
  // 失去 externalApi.relay 能力的 key 退回普通模式（仍记录/存储），不报错。
  const relayOnly =
    apiKey.relayOnly === true &&
    (await canUsePlanCapability(plan.plan, "externalApi.relay"));

  await db
    .update(externalApiKey)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(externalApiKey.id, apiKey.id));

  return {
    apiKeyId: apiKey.id,
    userId: apiKey.userId,
    plan: plan.plan,
    moderationBlockRiskLevel: (
      isModerationBlockRiskLevel(apiKey.moderationBlockRiskLevel)
        ? apiKey.moderationBlockRiskLevel
        : "low"
    ) satisfies ModerationBlockRiskLevel,
    creditLimit: apiKey.creditLimit ?? null,
    creditsUsed: Number(apiKey.creditsUsed || 0),
    relayOnly,
  };
}
