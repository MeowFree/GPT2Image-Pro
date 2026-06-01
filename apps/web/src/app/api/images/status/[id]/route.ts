import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildStorageUrl,
  getImageOutputs,
  getPromptRepairNotice,
  getResponseOutput,
} from "../status-output";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export const GET = withApiLogging(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return jsonError("Unauthorized", 401);

    const { id } = await params;
    if (!id || id.length > 128) return jsonError("Invalid generation id.");

    const [row] = await db
      .select()
      .from(generation)
      .where(and(eq(generation.id, id), eq(generation.userId, session.user.id)))
      .limit(1);

    if (!row) return jsonError("Generation not found", 404);

    const imageUrl = buildStorageUrl(row.storageBucket, row.storageKey);
    const imageOutputs = getImageOutputs(row.metadata, row.storageBucket);
    const responseOutput = getResponseOutput(row.metadata);

    return NextResponse.json({
      generationId: row.id,
      status: row.status,
      prompt: row.prompt,
      model: row.model,
      size: row.size,
      revisedPrompt: row.revisedPrompt,
      promptRepairNotice: getPromptRepairNotice(row.metadata),
      error: row.error,
      creditsConsumed: row.creditsConsumed,
      imageUrl,
      imageOutputs,
      ...responseOutput,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString(),
    });
  }
);
