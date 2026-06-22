/**
 * GET /v1/videos/{id} —— 按 id 查询一次视频生成（外部 API）。
 *
 * 先查进程内异步任务存储（async=true 返回的 task_...,临时态);未命中再按 generation_id
 * 从 DB 持久取回 video_generation（同步请求也可用此方式复查,跨重启/多实例都稳)。
 * getVideoGenerationById 不带归属过滤,handler 内显式校验 userId 防越权(IDOR)。
 */

import { withApiLogging } from "@repo/shared/api-logger";
import { buildSignedStorageImageUrl } from "@repo/shared/storage/signed-url";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import type { NextRequest } from "next/server";
import {
  getAsyncImageTask,
  toAsyncImageTaskResponse,
  toVideoGenerationTaskResponse,
} from "@/features/external-api/async-image-tasks";
import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import { openAIImageError } from "@/features/external-api/images";
import { getVideoGenerationById } from "@/features/image-generation/video-operations";

export const getExternalVideoTask = withApiLogging(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
  ) => {
    const auth = await authenticateExternalApiRequest(request);
    if (!auth) {
      return openAIImageError(
        "Invalid or missing API key",
        401,
        "invalid_api_key"
      );
    }

    const { taskId } = await params;
    if (!taskId || taskId.length > 128) {
      return openAIImageError("Invalid task_id.");
    }

    // 1. 内存异步任务(async=true 创建,按 task_<uuid> 为键)。
    const task = getAsyncImageTask(taskId);
    if (
      task &&
      task.userId === auth.userId &&
      (!task.apiKeyId || task.apiKeyId === auth.apiKeyId)
    ) {
      return Response.json(toAsyncImageTaskResponse(task), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // 2. 按 generation_id 从 video_generation 持久取回(归属校验防越权)。
    const row = await getVideoGenerationById(taskId);
    if (row && row.userId === auth.userId) {
      const bucket =
        (await getRuntimeSettingString(
          "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME"
        )) || "generations";
      const videoUrl = row.storageKey
        ? buildSignedStorageImageUrl(row.storageKey, bucket)
        : null;
      return Response.json(toVideoGenerationTaskResponse(row, videoUrl), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return openAIImageError("Video task not found or expired.", 404);
  }
);
