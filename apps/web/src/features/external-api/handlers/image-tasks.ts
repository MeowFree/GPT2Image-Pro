import { withApiLogging } from "@repo/shared/api-logger";
import type { NextRequest } from "next/server";
import {
  getAsyncImageTask,
  toAsyncImageTaskResponse,
} from "@/features/external-api/async-image-tasks";
import { authenticateExternalApiRequest } from "@/features/external-api/auth";
import { openAIImageError } from "@/features/external-api/images";

export const getExternalImageTask = withApiLogging(
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

    const task = getAsyncImageTask(taskId);
    if (
      !task ||
      task.userId !== auth.userId ||
      (task.apiKeyId && task.apiKeyId !== auth.apiKeyId)
    ) {
      return openAIImageError("Image task not found or expired.", 404);
    }

    return Response.json(toAsyncImageTaskResponse(task), {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
);
