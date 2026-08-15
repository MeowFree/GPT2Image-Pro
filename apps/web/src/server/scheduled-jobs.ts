import { processExpiredBatches } from "@repo/shared/credits/core";
import {
  destroyExpiredGenerationPhotos,
  destroyGenerationPhotosByMaxCount,
  expireStalePendingGenerations,
} from "@repo/shared/generation-maintenance";
import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingSelect,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";

import { runChatgptRegisterBatch } from "@/features/image-backend-pool/chatgpt-register-runner";
import {
  countAvailableWebAccountsInGroup,
  refreshStaleWebBackendAccounts,
  runAutoSub2ApiAccessTokenSync,
} from "@/features/image-backend-pool/service";
import {
  buildCreditsExpireResponse,
  summarizeExpiredPendingGenerations,
} from "@/server/scheduled-jobs-response";

export async function runImageMaintenanceJob() {
  // 图片清理三态模式：off=不清理（永久保存，默认）；time=按时间过期；
  // count=按最大保留张数删最老图。互斥：每次维护只跑其中一种照片清理逻辑，
  // 避免两套逻辑重复处理同一行。模式取值与设置项 options 逐字一致。
  const retentionMode = await getRuntimeSettingSelect(
    "GENERATION_IMAGE_RETENTION_MODE",
    ["off", "time", "count"] as const,
    "off"
  );

  const photoRetentionTask =
    retentionMode === "time"
      ? destroyExpiredGenerationPhotos()
      : retentionMode === "count"
        ? destroyGenerationPhotosByMaxCount()
        : Promise.resolve({
            enabled: false as const,
            destroyed: 0,
            failed: 0,
            storageObjectsDeleted: 0,
            details: [] as Array<{
              generationId: string;
              userId: string;
              storageObjectsDeleted: number;
            }>,
          });

  const [pendingResults, photoRetention] = await Promise.all([
    expireStalePendingGenerations(),
    photoRetentionTask,
  ]);

  return {
    success: true,
    ...summarizeExpiredPendingGenerations(pendingResults),
    details: pendingResults,
    retentionMode,
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

/**
 * 号池自动维持任务：目标分组可用 web 账号数低于目标值时，调注册机自动补号。
 *
 * 流程：读开关/目标分组/目标可用数/每轮上限/并发 → 统计当前可用数 → 计算缺口
 * deficit=target-available，取 min(deficit, maxPerRun) 调 runChatgptRegisterBatch
 * 注册并导入目标分组。注册成功率受 OpenAI 机房 IP 检测影响（部分尝试会失败），
 * 故单轮可能补不满，靠多轮逼近目标；maxPerRun 限制单轮突发。
 *
 * 幂等/并发：本任务由内部调度器的 PG advisory 锁保证跨副本单飞；注册机 sidecar
 * 亦自带单飞，二者叠加确保不会并发跑多批。
 */
export async function runWebAccountsReplenishJob() {
  const enabled = await getRuntimeSettingBoolean(
    "CHATGPT_REGISTER_POOL_MAINTAIN_ENABLED",
    false
  );
  if (!enabled) {
    return { success: true, skipped: "disabled" as const };
  }

  const groupId = (
    await getRuntimeSettingString("CHATGPT_REGISTER_POOL_MAINTAIN_GROUP_ID")
  )?.trim();
  const target = await getRuntimeSettingNumber(
    "CHATGPT_REGISTER_POOL_MAINTAIN_TARGET",
    0
  );
  if (!groupId || target <= 0) {
    return { success: true, skipped: "not_configured" as const };
  }

  const available = await countAvailableWebAccountsInGroup(groupId);
  const deficit = target - available;
  if (deficit <= 0) {
    return {
      success: true,
      skipped: "target_met" as const,
      available,
      target,
    };
  }

  const maxPerRun = await getRuntimeSettingNumber(
    "CHATGPT_REGISTER_POOL_MAINTAIN_MAX_PER_RUN",
    10,
    { positive: true }
  );
  const concurrency = await getRuntimeSettingNumber(
    "CHATGPT_REGISTER_POOL_MAINTAIN_CONCURRENCY",
    5,
    { positive: true }
  );
  const toRegister = Math.min(deficit, maxPerRun);

  const batch = await runChatgptRegisterBatch({
    count: toRegister,
    concurrency,
    webGroupId: groupId,
    namePrefix: "auto",
  });

  return {
    success: true,
    available,
    target,
    deficit,
    toRegister,
    imported: batch.imported,
    failed: batch.failed,
    skipped: batch.skipped,
    timestamp: new Date().toISOString(),
  };
}
