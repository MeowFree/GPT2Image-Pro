import { getCreditsBalance } from "@repo/shared/credits/core";
import { withApiLogging } from "@repo/shared/api-logger";
import { type NextRequest, NextResponse } from "next/server";

import { authenticateExternalApiRequest } from "@repo/shared/external-api/auth";
import { getExternalApiKeyQuota } from "@repo/shared/external-api/quota";
import { openAIImageError } from "@repo/image-generation/external-api-images";

export const getExternalCredits = withApiLogging(
  async (request: NextRequest) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIImageError(
        "Invalid or missing API key",
        401,
        "invalid_api_key"
      );
    }

    const [accountBalance, keyQuota] = await Promise.all([
      getCreditsBalance(auth.userId),
      getExternalApiKeyQuota({
        apiKeyId: auth.apiKeyId,
        userId: auth.userId,
      }),
    ]);

    return NextResponse.json(
      {
        object: "credit_balance",
        account: {
          balance: accountBalance.balance,
          total_earned: accountBalance.totalEarned,
          total_spent: accountBalance.totalSpent,
          status: accountBalance.status,
        },
        api_key: {
          id: keyQuota.id,
          name: keyQuota.name,
          key_prefix: keyQuota.keyPrefix,
          last_four: keyQuota.lastFour,
          is_active: keyQuota.isActive,
          credit_limit: keyQuota.creditLimit,
          credits_used: keyQuota.creditsUsed,
          credits_remaining: keyQuota.creditsRemaining,
          unlimited: keyQuota.creditLimit === null,
          last_used_at: keyQuota.lastUsedAt,
          created_at: keyQuota.createdAt,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
);
