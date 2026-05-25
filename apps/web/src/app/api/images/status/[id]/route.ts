import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildStorageUrl(bucket: string | null, key: string | null) {
  return key ? `/api/storage/${bucket || "generations"}/${key}` : undefined;
}

function getImageOutputs(metadata: unknown, bucket: string | null) {
  const outputImage = asRecord(asRecord(metadata).outputImage);
  const outputs = outputImage.imageOutputs;
  if (!Array.isArray(outputs)) return [];
  return outputs.flatMap((item, index) => {
    const output = asRecord(item);
    const storageKey = stringValue(output.storageKey);
    const imageUrl =
      stringValue(output.imageUrl) ||
      (storageKey ? buildStorageUrl(bucket, storageKey) : undefined);
    const generationId = stringValue(output.generationId);
    if (!imageUrl && !generationId) return [];
    return [
      {
        generationId,
        imageUrl,
        imageFileId: stringValue(output.imageFileId),
        webImageMessageId: stringValue(output.webImageMessageId),
        webImageGroupId: stringValue(output.webImageGroupId),
        size: stringValue(output.size),
        revisedPrompt: stringValue(output.revisedPrompt),
        upstreamRevisedPrompt: stringValue(output.upstreamRevisedPrompt),
        index,
        outputRole:
          output.role === "agent_draft" ||
          output.role === "choice" ||
          output.role === "final"
            ? output.role
            : undefined,
      },
    ];
  });
}

function getResponseOutput(metadata: unknown) {
  const output = asRecord(asRecord(metadata).responseOutput);
  return {
    responseText: stringValue(output.responseText),
    responseThinking: stringValue(output.responseThinking),
    responseAgent: stringValue(output.responseAgent),
    agentEvents: Array.isArray(output.agentEvents)
      ? output.agentEvents
      : undefined,
    agentRoundCount:
      typeof output.agentRoundCount === "number"
        ? output.agentRoundCount
        : undefined,
    webConversation:
      output.webConversation && typeof output.webConversation === "object"
        ? output.webConversation
        : undefined,
    backendMember:
      output.backendMember && typeof output.backendMember === "object"
        ? output.backendMember
        : undefined,
    responsesPreviousResponse:
      output.responsesPreviousResponse &&
      typeof output.responsesPreviousResponse === "object"
        ? output.responsesPreviousResponse
        : undefined,
  };
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
