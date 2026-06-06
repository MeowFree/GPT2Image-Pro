"use server";

import { logError } from "@repo/shared/logger";
import { protectedAction } from "@repo/shared/safe-action";
import { buildSignedStorageImageUrl } from "@repo/shared/storage";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getGenerationById } from "@/features/image-generation/queries";
import { readLayeredMeta } from "./layered-meta";
import { exportLayeredPsdForUser } from "./orchestrator";

/** PSD 签名下载链接有效期(秒):覆盖后台分解耗时 + 用户下载。 */
const PSD_SIGNED_URL_TTL_SECONDS = 7200;

/**
 * 导出分层 PSD(异步)。
 *
 * 把"生成即分层"的 agent 产物(整图/背景/各元素)组装成可编辑分层 PSD(不生成新图、不扣费)。
 * WHY 异步:逐元素 ISNet 抠图 + ag-psd 写盘可能数十秒、超 Cloudflare 100s。故先同步校验,算好
 * PSD 存储 key 与签名 URL,**后台开跑(不 await)**,立即返回 URL;前端轮询该 URL(对象未写入时
 * 存储路由返回 404,写好返回 200)。
 */
const exportPsdSchema = z.object({
  generationId: z.string().min(1),
});

export const exportPsdAction = protectedAction
  .metadata({ action: "psd-export.export" })
  .schema(exportPsdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const base = await getGenerationById(parsedInput.generationId);
    if (!base || base.userId !== ctx.userId) {
      throw new Error("底图不存在或无权访问");
    }
    if (base.status !== "completed" || !base.storageKey) {
      throw new Error("产物尚未完成,无法导出 PSD");
    }
    if (!readLayeredMeta(base.metadata)) {
      throw new Error("该图不是分层生成产物,无法导出分层 PSD");
    }

    const bucket = base.storageBucket || "generations";
    const psdStorageKey = `${ctx.userId}/${nanoid(32)}.psd`;
    const psdSignedUrl =
      buildSignedStorageImageUrl(
        psdStorageKey,
        bucket,
        PSD_SIGNED_URL_TTL_SECONDS
      ) || "";

    // 后台分解:不 await,避免请求阻塞超时。完成后 PSD 写到 psdStorageKey,前端轮询签名 URL。
    void exportLayeredPsdForUser({
      userId: ctx.userId,
      generationId: parsedInput.generationId,
      psdStorageKey,
    }).catch((error) => {
      logError(error, {
        source: "psd-export.background",
        userId: ctx.userId,
        psdStorageKey,
      });
    });

    return { psdSignedUrl };
  });
