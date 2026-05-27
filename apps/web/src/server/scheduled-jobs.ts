import { processExpiredBatches } from "@repo/shared/credits/core";
import {
  destroyExpiredGenerationPhotos,
  expireStalePendingGenerations,
} from "@repo/shared/generation-maintenance";
import { getRuntimeSettingNumber } from "@repo/shared/system-settings";

import {
  refreshStaleWebBackendAccounts,
  runAutoSub2ApiAccessTokenSync,
} from "@/features/image-backend-pool/service";

export async function runImageMaintenanceJob() {
  const [pendingResults, photoRetention] = await Promise.all([
    expireStalePendingGenerations({ limit: 500 }),
    destroyExpiredGenerationPhotos({ limit: 500 }),
  ]);

  return {
    success: true,
    expired: pendingResults.length,
    creditsRefunded: pendingResults.reduce(
      (total, item) => total + item.creditsRefunded,
      0
    ),
    details: pendingResults,
    photoRetention,
    timestamp: new Date().toISOString(),
  };
}

export async function runCreditsExpireJob() {
  const results = await processExpiredBatches();

  return {
    success: true,
    processed: results.length,
    details: results.map((result) => ({
      batchId: result.batchId,
      userId: result.userId,
      expiredAmount: result.expiredAmount,
    })),
    timestamp: new Date().toISOString(),
  };
}

export async function runWebAccountsRefreshJob() {
  const staleMinutes = await getRuntimeSettingNumber(
    "CHATGPT_WEB_ACCOUNT_REFRESH_STALE_MINUTES",
    30,
    { positive: true }
  );
  const limit = await getRuntimeSettingNumber(
    "CHATGPT_WEB_ACCOUNT_REFRESH_LIMIT",
    20,
    { positive: true }
  );
  const result = await refreshStaleWebBackendAccounts({
    staleMinutes,
    limit,
  });

  return {
    success: true,
    ...result,
    timestamp: new Date().toISOString(),
  };
}

export async function runSub2ApiSyncJob(options?: { force?: boolean }) {
  const result = await runAutoSub2ApiAccessTokenSync(options);
  return {
    ...result,
    timestamp: new Date().toISOString(),
  };
}
