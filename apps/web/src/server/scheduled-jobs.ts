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
import {
  buildCreditsExpireResponse,
  summarizeExpiredPendingGenerations,
} from "@/server/scheduled-jobs-response";

/**
 * 单次图像维护 cron 扫描的最大处理行数。
 * 同时作为超时 pending 过期与超期成品图销毁的批量上限，避免单次任务无界扫描。
 */
const IMAGE_MAINTENANCE_BATCH_LIMIT = 500;

export async function runImageMaintenanceJob() {
  const [pendingResults, photoRetention] = await Promise.all([
    expireStalePendingGenerations({ limit: IMAGE_MAINTENANCE_BATCH_LIMIT }),
    destroyExpiredGenerationPhotos({ limit: IMAGE_MAINTENANCE_BATCH_LIMIT }),
  ]);

  return {
    success: true,
    ...summarizeExpiredPendingGenerations(pendingResults),
    details: pendingResults,
    photoRetention,
    timestamp: new Date().toISOString(),
  };
}

export async function runCreditsExpireJob() {
  const results = await processExpiredBatches();

  return {
    ...buildCreditsExpireResponse(results),
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
