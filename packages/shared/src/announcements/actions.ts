"use server";

import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@repo/database";
import {
  adminAuditLog,
  announcement,
  announcementRead,
} from "@repo/database/schema";
import { adminAction, protectedAction } from "../safe-action";
import {
  announcementIdSchema,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from "./schemas";

export type AdminAnnouncementItem = {
  id: string;
  title: string;
  content: string;
  severity: string;
  isPublished: boolean;
  isPinned: boolean;
  priority: number;
  publishedAt: string | null;
  expiresAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

const withAnnouncementAction = (name: string) =>
  protectedAction.metadata({ action: `announcements.${name}` });
const withAdminAnnouncementAction = (name: string) =>
  adminAction.metadata({ action: `announcements.admin.${name}` });

const activeAnnouncementFilter = () => {
  const now = new Date();
  return and(
    eq(announcement.isPublished, true),
    or(isNull(announcement.publishedAt), lte(announcement.publishedAt, now)),
    or(isNull(announcement.expiresAt), sql`${announcement.expiresAt} > ${now}`)
  );
};

const announcementOrder = [
  desc(announcement.isPinned),
  desc(announcement.priority),
  desc(announcement.publishedAt),
  desc(announcement.createdAt),
];

function parseOptionalDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("时间格式不正确");
  }
  return date;
}

function sanitizeSnapshot(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function writeAnnouncementAuditLog(params: {
  adminUserId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(adminAuditLog).values({
    id: crypto.randomUUID(),
    adminUserId: params.adminUserId,
    action: params.action,
    before: sanitizeSnapshot(params.before),
    after: sanitizeSnapshot(params.after),
    metadata: params.metadata,
  });
}

function serializeAdminAnnouncement(
  row: typeof announcement.$inferSelect
): AdminAnnouncementItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    severity: row.severity,
    isPublished: row.isPublished,
    isPinned: row.isPinned,
    priority: row.priority,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listActiveAnnouncementsForUser(userId: string) {
  return db
    .select({
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
      severity: announcement.severity,
      isPinned: announcement.isPinned,
      priority: announcement.priority,
      publishedAt: announcement.publishedAt,
      expiresAt: announcement.expiresAt,
      createdAt: announcement.createdAt,
      readAt: announcementRead.readAt,
    })
    .from(announcement)
    .leftJoin(
      announcementRead,
      and(
        eq(announcementRead.announcementId, announcement.id),
        eq(announcementRead.userId, userId)
      )
    )
    .where(activeAnnouncementFilter())
    .orderBy(...announcementOrder);
}

export async function countUnreadAnnouncementsForUser(userId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(announcement)
    .leftJoin(
      announcementRead,
      and(
        eq(announcementRead.announcementId, announcement.id),
        eq(announcementRead.userId, userId)
      )
    )
    .where(and(activeAnnouncementFilter(), isNull(announcementRead.id)));

  return row?.count ?? 0;
}

export async function markAnnouncementIdsReadForUser(
  userId: string,
  announcementIds: string[]
) {
  const uniqueIds = Array.from(new Set(announcementIds)).filter(Boolean);
  if (uniqueIds.length === 0) {
    return 0;
  }

  await db
    .insert(announcementRead)
    .values(
      uniqueIds.map((announcementId) => ({
        id: crypto.randomUUID(),
        announcementId,
        userId,
      }))
    )
    .onConflictDoNothing();

  return uniqueIds.length;
}

export const getMyUnreadAnnouncementCountAction = withAnnouncementAction(
  "getMyUnreadCount"
).action(async ({ ctx }) => {
  const count = await countUnreadAnnouncementsForUser(ctx.userId);
  return { count };
});

export const markAllAnnouncementsReadAction = withAnnouncementAction(
  "markAllRead"
).action(async ({ ctx }) => {
  const rows = await db
    .select({ id: announcement.id })
    .from(announcement)
    .leftJoin(
      announcementRead,
      and(
        eq(announcementRead.announcementId, announcement.id),
        eq(announcementRead.userId, ctx.userId)
      )
    )
    .where(and(activeAnnouncementFilter(), isNull(announcementRead.id)));

  await markAnnouncementIdsReadForUser(
    ctx.userId,
    rows.map((row) => row.id)
  );

  revalidatePath("/dashboard/announcements");
  return { count: rows.length };
});

export const markAnnouncementReadAction = withAnnouncementAction("markRead")
  .schema(announcementIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [target] = await db
      .select({ id: announcement.id })
      .from(announcement)
      .where(and(eq(announcement.id, parsedInput.id), activeAnnouncementFilter()))
      .limit(1);

    if (!target) {
      throw new Error("公告不存在或已过期");
    }

    await db
      .insert(announcementRead)
      .values({
        id: crypto.randomUUID(),
        announcementId: target.id,
        userId: ctx.userId,
      })
      .onConflictDoNothing();

    revalidatePath("/dashboard/announcements");
    return { message: "已标记为已读" };
  });

export async function listAnnouncementsForAdmin() {
  return db
    .select()
    .from(announcement)
    .orderBy(desc(announcement.isPinned), desc(announcement.updatedAt));
}

export const getAdminAnnouncementsAction = withAdminAnnouncementAction("list")
  .action(async () => {
    const rows = await listAnnouncementsForAdmin();
    return { announcements: rows.map(serializeAdminAnnouncement) };
  });

export const createAnnouncementAction = withAdminAnnouncementAction("create")
  .schema(createAnnouncementSchema)
  .action(async ({ parsedInput, ctx }) => {
    const now = new Date();
    const publishedAt = parsedInput.isPublished
      ? parseOptionalDate(parsedInput.publishedAt) ?? now
      : parseOptionalDate(parsedInput.publishedAt);

    const row = {
      id: crypto.randomUUID(),
      title: parsedInput.title,
      content: parsedInput.content,
      severity: parsedInput.severity,
      isPublished: parsedInput.isPublished,
      isPinned: parsedInput.isPinned,
      priority: parsedInput.priority,
      publishedAt,
      expiresAt: parseOptionalDate(parsedInput.expiresAt),
      createdByUserId: ctx.userId,
      updatedByUserId: ctx.userId,
      updatedAt: now,
    };

    await db.insert(announcement).values(row);
    await writeAnnouncementAuditLog({
      adminUserId: ctx.userId,
      action: "announcement.create",
      after: row,
    });

    revalidatePath("/dashboard/announcements");
    revalidatePath("/dashboard/admin/announcements");
    return { message: "公告已创建", id: row.id };
  });

export const updateAnnouncementAction = withAdminAnnouncementAction("update")
  .schema(updateAnnouncementSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [before] = await db
      .select()
      .from(announcement)
      .where(eq(announcement.id, parsedInput.id))
      .limit(1);

    if (!before) {
      throw new Error("公告不存在");
    }

    const publishedAt = parsedInput.isPublished
      ? parseOptionalDate(parsedInput.publishedAt) ?? before.publishedAt ?? new Date()
      : parseOptionalDate(parsedInput.publishedAt);

    const updateData = {
      title: parsedInput.title,
      content: parsedInput.content,
      severity: parsedInput.severity,
      isPublished: parsedInput.isPublished,
      isPinned: parsedInput.isPinned,
      priority: parsedInput.priority,
      publishedAt,
      expiresAt: parseOptionalDate(parsedInput.expiresAt),
      updatedByUserId: ctx.userId,
      updatedAt: new Date(),
    };

    const [after] = await db
      .update(announcement)
      .set(updateData)
      .where(eq(announcement.id, parsedInput.id))
      .returning();

    await writeAnnouncementAuditLog({
      adminUserId: ctx.userId,
      action: "announcement.update",
      before,
      after,
    });

    revalidatePath("/dashboard/announcements");
    revalidatePath("/dashboard/admin/announcements");
    return { message: "公告已更新" };
  });

export const deleteAnnouncementAction = withAdminAnnouncementAction("delete")
  .schema(announcementIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [before] = await db
      .select()
      .from(announcement)
      .where(eq(announcement.id, parsedInput.id))
      .limit(1);

    if (!before) {
      throw new Error("公告不存在");
    }

    await db.delete(announcement).where(eq(announcement.id, parsedInput.id));
    await writeAnnouncementAuditLog({
      adminUserId: ctx.userId,
      action: "announcement.delete",
      before,
    });

    revalidatePath("/dashboard/announcements");
    revalidatePath("/dashboard/admin/announcements");
    return { message: "公告已删除" };
  });

export const toggleAnnouncementPublishAction = withAdminAnnouncementAction(
  "togglePublish"
)
  .schema(announcementIdSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [before] = await db
      .select()
      .from(announcement)
      .where(eq(announcement.id, parsedInput.id))
      .limit(1);

    if (!before) {
      throw new Error("公告不存在");
    }

    const nextPublished = !before.isPublished;
    const [after] = await db
      .update(announcement)
      .set({
        isPublished: nextPublished,
        publishedAt:
          nextPublished && !before.publishedAt ? new Date() : before.publishedAt,
        updatedByUserId: ctx.userId,
        updatedAt: new Date(),
      })
      .where(eq(announcement.id, parsedInput.id))
      .returning();

    await writeAnnouncementAuditLog({
      adminUserId: ctx.userId,
      action: nextPublished ? "announcement.publish" : "announcement.unpublish",
      before,
      after,
    });

    revalidatePath("/dashboard/announcements");
    revalidatePath("/dashboard/admin/announcements");
    return { message: nextPublished ? "公告已发布" : "公告已下线" };
  });
