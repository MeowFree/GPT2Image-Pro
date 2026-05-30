import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";

import { db } from "@repo/database";
import { creditsBatch, generation } from "@repo/database/schema";
import { grantCredits } from "./credits/core";
import { getFailedGenerationTargetCreditsFromMetadata } from "./generation-settlement";
import { logError } from "./logger";
import { getStorageProvider } from "./storage/providers";
import { getRuntimeSettingNumber } from "./system-settings";

export const IMAGE_GENERATION_PENDING_TIMEOUT_MS = 20 * 60 * 1000;
export const IMAGE_GENERATION_TIMEOUT_ERROR =
  "Image generation timed out after 20 minutes. Generation credits were refunded.";
export const GENERATION_IMAGE_RETENTION_HOURS_SETTING_KEY =
  "GENERATION_IMAGE_RETENTION_HOURS";

type ExpireStalePendingGenerationsOptions = {
  userId?: string;
  now?: Date;
  limit?: number;
  timeoutMs?: number;
};

type DestroyExpiredGenerationPhotosOptions = {
  now?: Date;
  limit?: number;
  retentionHours?: number;
};

export type GenerationImageStorageReference = {
  bucket: string;
  key: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getGenerationBucket(bucket?: string | null) {
  return (
    bucket || process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations"
  );
}

/**
 * 计算超时退款金额（纯函数，DB-free）。
 *
 * 退款 = max(0, 已扣 - 目标保留)。Math.max(0) 防止 target>charged 时退成负数（多退）。
 * sourceRef 由调用方按 `${genId}:timeout-refund` 拼接做幂等键，避免重复退款。
 */
export function computeTimeoutRefund(params: {
  chargedCredits: number;
  targetCredits: number;
}) {
  const chargedCredits = Math.max(0, params.chargedCredits);
  const targetCredits = Math.max(0, params.targetCredits);
  return Math.max(0, chargedCredits - targetCredits);
}

/**
 * 解析照片保留窗口（纯函数，DB-free）。
 *
 * retentionHours<=0（默认 0=永久保留）短路返回 {enabled:false, cutoff:null}，
 * 是阻止全站已完成图片被批量删除的唯一防线；否则 cutoff=now-retentionHours 小时。
 */
export function resolvePhotoRetentionWindow(
  retentionHours: number,
  now: Date
): { enabled: boolean; cutoff: Date | null } {
  if (retentionHours <= 0) {
    return { enabled: false, cutoff: null };
  }
  return {
    enabled: true,
    cutoff: new Date(now.getTime() - retentionHours * 60 * 60 * 1000),
  };
}

export function collectGenerationImageStorageReferences(params: {
  storageKey?: string | null;
  storageBucket?: string | null;
  metadata?: Record<string, unknown> | null;
}): GenerationImageStorageReference[] {
  const defaultBucket = getGenerationBucket(params.storageBucket);
  const refs = new Map<string, GenerationImageStorageReference>();
  const addReference = (key: unknown, bucketValue?: unknown) => {
    const storageKey = stringValue(key);
    if (!storageKey) return;
    const bucket = stringValue(bucketValue) || defaultBucket;
    refs.set(`${bucket}:${storageKey}`, { bucket, key: storageKey });
  };

  addReference(params.storageKey);

  const outputImage = isRecord(params.metadata?.outputImage)
    ? params.metadata.outputImage
    : null;
  const outputs = Array.isArray(outputImage?.imageOutputs)
    ? outputImage.imageOutputs
    : [];
  for (const output of outputs) {
    if (!isRecord(output)) continue;
    addReference(output.storageKey, output.storageBucket);
  }

  const inputImages = isRecord(params.metadata?.inputImages)
    ? params.metadata.inputImages
    : null;
  const images = Array.isArray(inputImages?.images) ? inputImages.images : [];
  for (const image of images) {
    if (!isRecord(image)) continue;
    addReference(image.storageKey, image.storageBucket);
  }

  return Array.from(refs.values());
}

export function stripDestroyedGenerationImageReferences(
  metadata: Record<string, unknown> | null | undefined,
  params: {
    destroyedAt: string;
    retentionHours: number;
    storageObjectsDeleted: number;
  }
) {
  const nextMetadata = isRecord(metadata) ? { ...metadata } : {};
  const outputImage = isRecord(nextMetadata.outputImage)
    ? { ...nextMetadata.outputImage }
    : {};

  if (Array.isArray(outputImage.imageOutputs)) {
    outputImage.imageOutputs = outputImage.imageOutputs.map((output) => {
      if (!isRecord(output)) return output;
      const nextOutput = { ...output };
      delete nextOutput.storageKey;
      delete nextOutput.imageUrl;
      delete nextOutput.imageFileId;
      delete nextOutput.webImageMessageId;
      delete nextOutput.webImageGroupId;
      return nextOutput;
    });
  }

  outputImage.photoRetention = {
    destroyedAt: params.destroyedAt,
    retentionHours: params.retentionHours,
    storageObjectsDeleted: params.storageObjectsDeleted,
  };
  nextMetadata.outputImage = outputImage;

  const inputImages = isRecord(nextMetadata.inputImages)
    ? { ...nextMetadata.inputImages }
    : null;
  if (inputImages) {
    if (Array.isArray(inputImages.images)) {
      inputImages.images = inputImages.images.map((image) => {
        if (!isRecord(image)) return image;
        const nextImage = { ...image };
        delete nextImage.storageKey;
        delete nextImage.storageBucket;
        delete nextImage.imageUrl;
        return nextImage;
      });
    }
    inputImages.photoRetention = {
      destroyedAt: params.destroyedAt,
      retentionHours: params.retentionHours,
      storageObjectsDeleted: params.storageObjectsDeleted,
    };
    nextMetadata.inputImages = inputImages;
  }

  const responseOutput = isRecord(nextMetadata.responseOutput)
    ? { ...nextMetadata.responseOutput }
    : null;
  if (responseOutput && Array.isArray(responseOutput.agentEvents)) {
    responseOutput.agentEvents = responseOutput.agentEvents.map((event) => {
      if (!isRecord(event)) return event;
      const nextEvent = { ...event };
      delete nextEvent.imageUrl;
      return nextEvent;
    });
    nextMetadata.responseOutput = responseOutput;
  }

  return nextMetadata;
}

async function refundAlreadyGranted(userId: string, sourceRef: string) {
  const [existing] = await db
    .select({ id: creditsBatch.id })
    .from(creditsBatch)
    .where(
      and(
        eq(creditsBatch.userId, userId),
        eq(creditsBatch.sourceType, "refund"),
        eq(creditsBatch.sourceRef, sourceRef)
      )
    )
    .limit(1);

  return Boolean(existing);
}

export async function refundGenerationCredits(params: {
  generationId: string;
  userId: string;
  amount: number;
  sourceRef: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  if (params.amount <= 0) {
    return { refunded: false, amount: 0 };
  }

  if (await refundAlreadyGranted(params.userId, params.sourceRef)) {
    return { refunded: false, amount: params.amount };
  }

  await grantCredits({
    userId: params.userId,
    amount: params.amount,
    sourceType: "refund",
    debitAccount: "SYSTEM:generation_refund",
    transactionType: "refund",
    sourceRef: params.sourceRef,
    description: params.description,
    metadata: {
      generationId: params.generationId,
      ...params.metadata,
    },
  });

  return { refunded: true, amount: params.amount };
}

export async function expireStalePendingGenerations(
  options: ExpireStalePendingGenerationsOptions = {}
) {
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? IMAGE_GENERATION_PENDING_TIMEOUT_MS;
  const cutoff = new Date(now.getTime() - timeoutMs);
  const conditions = [
    eq(generation.status, "pending" as const),
    lt(generation.createdAt, cutoff),
  ];

  if (options.userId) {
    conditions.push(eq(generation.userId, options.userId));
  }

  const staleRows = await db
    .select({
      id: generation.id,
      userId: generation.userId,
      prompt: generation.prompt,
      creditsConsumed: generation.creditsConsumed,
      metadata: generation.metadata,
      createdAt: generation.createdAt,
    })
    .from(generation)
    .where(and(...conditions))
    .orderBy(desc(generation.createdAt))
    .limit(options.limit ?? 100);

  const results: Array<{
    generationId: string;
    userId: string;
    creditsRefunded: number;
    refundGranted: boolean;
  }> = [];

  for (const row of staleRows) {
    const chargedCredits = Math.max(0, Number(row.creditsConsumed) || 0);
    const targetCredits = getFailedGenerationTargetCreditsFromMetadata({
      reason: "generation_error",
      chargedCredits,
      metadata: row.metadata,
    });
    const creditsToRefund = computeTimeoutRefund({
      chargedCredits,
      targetCredits,
    });
    const sourceRef = `${row.id}:timeout-refund`;

    const [updated] = await db
      .update(generation)
      .set({
        status: "failed",
        error: IMAGE_GENERATION_TIMEOUT_ERROR,
        completedAt: now,
        metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
          {
            timeout: {
              reason: "pending_timeout",
              timeoutMs,
              expiredAt: now.toISOString(),
              targetCredits,
              refundSourceRef: sourceRef,
              refundCredits: creditsToRefund,
            },
          }
        )}::jsonb`,
      })
      .where(
        and(
          eq(generation.id, row.id),
          eq(generation.status, "pending" as const)
        )
      )
      .returning({ id: generation.id });

    if (!updated) continue;

    let refundGranted = false;
    if (creditsToRefund > 0) {
      try {
        const refund = await refundGenerationCredits({
          generationId: row.id,
          userId: row.userId,
          amount: creditsToRefund,
          sourceRef,
          description: `Refund timed out image generation charge: ${row.prompt.slice(
            0,
            50
          )}`,
          metadata: {
            reason: "pending_timeout",
            createdAt: row.createdAt.toISOString(),
            expiredAt: now.toISOString(),
            timeoutMs,
          },
        });
        refundGranted = refund.refunded;

        await db
          .update(generation)
          .set({
            creditsConsumed: targetCredits,
            metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
              {
                timeoutRefund: {
                  sourceRef,
                  creditsRefunded: creditsToRefund,
                  granted: refund.refunded,
                  settledAt: now.toISOString(),
                },
              }
            )}::jsonb`,
          })
          .where(eq(generation.id, row.id));
      } catch (error) {
        logError(error, {
          source: "image-generation-timeout-refund",
          generationId: row.id,
          userId: row.userId,
          creditsToRefund,
        });
      }
    }

    results.push({
      generationId: row.id,
      userId: row.userId,
      creditsRefunded: refundGranted ? creditsToRefund : 0,
      refundGranted,
    });
  }

  return results;
}

export async function destroyExpiredGenerationPhotos(
  options: DestroyExpiredGenerationPhotosOptions = {}
) {
  const now = options.now ?? new Date();
  const retentionHours =
    options.retentionHours ??
    (await getRuntimeSettingNumber(
      GENERATION_IMAGE_RETENTION_HOURS_SETTING_KEY,
      0,
      { nonNegative: true }
    ));

  const window = resolvePhotoRetentionWindow(retentionHours, now);
  if (!window.enabled || !window.cutoff) {
    return {
      enabled: false,
      retentionHours,
      cutoff: null,
      destroyed: 0,
      failed: 0,
      storageObjectsDeleted: 0,
      details: [] as Array<{
        generationId: string;
        userId: string;
        storageObjectsDeleted: number;
      }>,
    };
  }

  const cutoff = window.cutoff;
  const rows = await db
    .select({
      id: generation.id,
      userId: generation.userId,
      storageKey: generation.storageKey,
      storageBucket: generation.storageBucket,
      metadata: generation.metadata,
      completedAt: generation.completedAt,
      createdAt: generation.createdAt,
    })
    .from(generation)
    .where(
      and(
        eq(generation.status, "completed" as const),
        isNotNull(generation.storageKey),
        sql`COALESCE(${generation.completedAt}, ${generation.createdAt}) < ${cutoff}`
      )
    )
    .orderBy(desc(generation.completedAt))
    .limit(options.limit ?? 500);

  const details: Array<{
    generationId: string;
    userId: string;
    storageObjectsDeleted: number;
  }> = [];
  let failed = 0;
  let storageObjectsDeleted = 0;
  const storage = rows.length > 0 ? await getStorageProvider() : null;

  for (const row of rows) {
    const refs = collectGenerationImageStorageReferences(row);
    if (refs.length === 0) continue;

    try {
      for (const ref of refs) {
        await storage?.deleteObject(ref.key, ref.bucket);
      }

      const destroyedAt = now.toISOString();
      const [updated] = await db
        .update(generation)
        .set({
          storageKey: null,
          fileSize: null,
          metadata: stripDestroyedGenerationImageReferences(row.metadata, {
            destroyedAt,
            retentionHours,
            storageObjectsDeleted: refs.length,
          }),
        })
        .where(
          and(
            eq(generation.id, row.id),
            eq(generation.status, "completed" as const),
            isNotNull(generation.storageKey)
          )
        )
        .returning({ id: generation.id });

      if (!updated) continue;

      storageObjectsDeleted += refs.length;
      details.push({
        generationId: row.id,
        userId: row.userId,
        storageObjectsDeleted: refs.length,
      });
    } catch (error) {
      failed += 1;
      logError(error, {
        source: "generation-photo-retention",
        generationId: row.id,
        userId: row.userId,
        retentionHours,
      });
    }
  }

  return {
    enabled: true,
    retentionHours,
    cutoff: cutoff.toISOString(),
    destroyed: details.length,
    failed,
    storageObjectsDeleted,
    details,
  };
}
