import { db } from "@repo/database";
import { ticketAttachment } from "@repo/database/schema";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { MAX_TICKET_ATTACHMENTS } from "@repo/shared/support/schemas";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { and, count, eq, gt, isNull, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import {
  MAX_TICKET_IMAGE_BYTES,
  TicketImageValidationError,
  validateTicketImageUpload,
} from "./validation";

const MAX_PENDING_ATTACHMENTS = MAX_TICKET_ATTACHMENTS * 3;
const PENDING_RATE_WINDOW_MS = 60 * 60 * 1000;
const STALE_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

export const POST = withApiLogging(async (request: NextRequest) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_TICKET_IMAGE_BYTES + 1024 * 1024
  ) {
    return NextResponse.json(
      { error: "单张图片不能超过 5MB" },
      { status: 413 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择图片" }, { status: 400 });
    }

    const storage = await getStorageProvider();
    const stale = await db
      .delete(ticketAttachment)
      .where(
        and(
          eq(ticketAttachment.uploaderId, session.user.id),
          isNull(ticketAttachment.messageId),
          lt(
            ticketAttachment.createdAt,
            new Date(Date.now() - STALE_PENDING_AGE_MS)
          )
        )
      )
      .returning({
        storageBucket: ticketAttachment.storageBucket,
        storageKey: ticketAttachment.storageKey,
      });
    if (stale.length > 0) {
      await Promise.allSettled(
        stale.map((attachment) =>
          storage.deleteObject(attachment.storageKey, attachment.storageBucket)
        )
      );
    }

    const [pending] = await db
      .select({ count: count() })
      .from(ticketAttachment)
      .where(
        and(
          eq(ticketAttachment.uploaderId, session.user.id),
          isNull(ticketAttachment.messageId),
          gt(
            ticketAttachment.createdAt,
            new Date(Date.now() - PENDING_RATE_WINDOW_MS)
          )
        )
      );
    if ((pending?.count ?? 0) >= MAX_PENDING_ATTACHMENTS) {
      return NextResponse.json(
        { error: "待提交图片过多，请先完成当前工单消息" },
        { status: 429 }
      );
    }

    const image = await validateTicketImageUpload(file);
    const attachmentId = crypto.randomUUID();
    const bucket =
      (await getRuntimeSettingString("NEXT_PUBLIC_GENERATIONS_BUCKET_NAME")) ||
      "generations";
    const key = `support/${session.user.id}/${attachmentId}.${image.extension}`;
    let uploaded = false;

    try {
      await storage.putObject(key, bucket, image.data, image.contentType);
      uploaded = true;
      await db.insert(ticketAttachment).values({
        id: attachmentId,
        uploaderId: session.user.id,
        fileName: image.fileName,
        contentType: image.contentType,
        size: image.size,
        storageBucket: bucket,
        storageKey: key,
      });
    } catch (error) {
      if (uploaded) {
        await storage.deleteObject(key, bucket).catch(() => undefined);
      }
      throw error;
    }

    return NextResponse.json({
      attachment: {
        id: attachmentId,
        fileName: image.fileName,
        contentType: image.contentType,
        size: image.size,
      },
    });
  } catch (error) {
    if (error instanceof TicketImageValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
});
