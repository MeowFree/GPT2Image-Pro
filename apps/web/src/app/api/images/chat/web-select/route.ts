import { db } from "@repo/database";
import { generation, imageBackendAccount } from "@repo/database/schema";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { and, eq, or, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { selectChatGptWebImageCandidate } from "@/features/image-generation/chatgpt-web";

const selectSchema = z.object({
  generationId: z.string().min(1).max(128),
});

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function findStoredOutput(metadata: unknown, generationId: string) {
  const outputImage = asRecord(asRecord(metadata).outputImage);
  const outputs = outputImage.imageOutputs;
  if (!Array.isArray(outputs)) return null;
  for (const item of outputs) {
    const output = asRecord(item);
    if (output.generationId === generationId) return output;
  }
  return null;
}

function metadataString(metadata: unknown, key: string) {
  const value = asRecord(metadata)[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metadataBackend(metadata: unknown) {
  return asRecord(asRecord(metadata).backend);
}

function metadataNumber(metadata: unknown, key: string) {
  const value = asRecord(metadata)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return jsonError("Unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const parsed = selectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message || "Invalid request");
  }

  const generationId = parsed.data.generationId;
  const [row] = await db
    .select({
      id: generation.id,
      metadata: generation.metadata,
    })
    .from(generation)
    .where(
      and(
        eq(generation.userId, session.user.id),
        eq(generation.status, "completed"),
        or(
          eq(generation.id, generationId),
          sql`${generation.metadata}::jsonb #> '{outputImage,imageOutputs}' @> ${JSON.stringify(
            [{ generationId }]
          )}::jsonb`
        )
      )
    )
    .limit(1);

  if (!row) return jsonError("Image candidate not found", 404);

  const metadata = asRecord(row.metadata);
  const selectedOutput =
    row.id === generationId
      ? findStoredOutput(metadata, generationId) || {}
      : findStoredOutput(metadata, generationId);
  if (!selectedOutput)
    return jsonError("Image candidate metadata not found", 404);

  const webImageMessageId = metadataString(selectedOutput, "webImageMessageId");
  const webImageGroupId = metadataString(selectedOutput, "webImageGroupId");
  const imageUrl = metadataString(selectedOutput, "imageUrl");
  const storageKey = metadataString(selectedOutput, "storageKey");
  const size = metadataString(selectedOutput, "size");
  const fileSize = metadataNumber(selectedOutput, "fileSize");
  const revisedPrompt = metadataString(selectedOutput, "revisedPrompt");
  const backend = metadataBackend(metadata);
  const accountId = metadataString(backend, "id");
  const apiKeyId = metadataString(backend, "apiKeyId");
  const webConversation = asRecord(metadata.webConversation);
  const conversationId = metadataString(webConversation, "conversationId");
  const selectionMessageId =
    metadataString(webConversation, "selectionMessageId") ||
    metadataString(webConversation, "parentMessageId");

  if (!webImageMessageId || !conversationId || !selectionMessageId) {
    return jsonError("This image is not a selectable ChatGPT Web candidate");
  }
  if (!accountId) return jsonError("Web account metadata is missing");

  const [account] = await db
    .select({
      id: imageBackendAccount.id,
      accessToken: imageBackendAccount.accessToken,
      implementationMode: imageBackendAccount.implementationMode,
      isEnabled: imageBackendAccount.isEnabled,
    })
    .from(imageBackendAccount)
    .where(eq(imageBackendAccount.id, accountId))
    .limit(1);

  if (!account || !account.isEnabled || account.implementationMode !== "web") {
    return jsonError("Web account is unavailable", 409);
  }

  try {
    await selectChatGptWebImageCandidate({
      config: {
        baseUrl: "https://chatgpt.com",
        apiKey: account.accessToken,
        backend: {
          type: "pool-account",
          id: account.id,
          userId: session.user.id,
          apiKeyId,
          requestKind: "chat",
          accountBackend: "web",
        },
      },
      conversationId,
      messageId: selectionMessageId,
      selectedImageMessageId: webImageMessageId,
    });
    await db
      .update(generation)
      .set({
        ...(storageKey ? { storageKey } : {}),
        ...(fileSize !== null ? { fileSize } : {}),
        ...(size ? { size } : {}),
        ...(revisedPrompt ? { revisedPrompt } : {}),
        metadata: sql`COALESCE(${generation.metadata}, '{}'::json)::jsonb || ${JSON.stringify(
          {
            webConversation: {
              ...webConversation,
              selectedImageMessageId: webImageMessageId,
            },
            webImageSelection: {
              generationId,
              imageUrl: imageUrl || null,
              webImageMessageId,
              webImageGroupId: webImageGroupId || null,
              selectedAt: new Date().toISOString(),
            },
          }
        )}::jsonb`,
      })
      .where(eq(generation.id, row.id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to sync Web selection",
      502
    );
  }
});
