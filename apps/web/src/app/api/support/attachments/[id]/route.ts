import { db } from "@repo/database";
import { ticket, ticketAttachment } from "@repo/database/schema";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { isAdminRole } from "@repo/shared/auth/roles";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { and, eq, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { canReadTicketAttachment } from "../validation";

type AttachmentRouteContext = {
  params: Promise<{ id: string }>;
};

export const GET = withApiLogging(
  async (request: NextRequest, context: AttachmentRouteContext) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const [record] = await db
      .select({
        attachment: ticketAttachment,
        ticketUserId: ticket.userId,
      })
      .from(ticketAttachment)
      .leftJoin(ticket, eq(ticketAttachment.ticketId, ticket.id))
      .where(eq(ticketAttachment.id, id))
      .limit(1);

    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let canRead = canReadTicketAttachment({
      sessionUserId: session.user.id,
      uploaderId: record.attachment.uploaderId,
      messageId: record.attachment.messageId,
      ticketUserId: record.ticketUserId,
      isAdmin: false,
    });
    if (!canRead) {
      canRead = canReadTicketAttachment({
        sessionUserId: session.user.id,
        uploaderId: record.attachment.uploaderId,
        messageId: record.attachment.messageId,
        ticketUserId: record.ticketUserId,
        isAdmin: isAdminRole(await getUserRoleById(session.user.id)),
      });
    }
    if (!canRead) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const storage = await getStorageProvider();
    const data = await storage.getObject(
      record.attachment.storageKey,
      record.attachment.storageBucket,
      { signal: request.signal }
    );

    return new NextResponse(Uint8Array.from(data), {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(data.length),
        "Content-Type": record.attachment.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
);

export const DELETE = withApiLogging(
  async (request: NextRequest, context: AttachmentRouteContext) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const [attachment] = await db
      .delete(ticketAttachment)
      .where(
        and(
          eq(ticketAttachment.id, id),
          eq(ticketAttachment.uploaderId, session.user.id),
          isNull(ticketAttachment.messageId)
        )
      )
      .returning({
        storageBucket: ticketAttachment.storageBucket,
        storageKey: ticketAttachment.storageKey,
      });

    if (attachment) {
      const storage = await getStorageProvider();
      await storage
        .deleteObject(attachment.storageKey, attachment.storageBucket)
        .catch(() => undefined);
    }

    return new NextResponse(null, { status: 204 });
  }
);
