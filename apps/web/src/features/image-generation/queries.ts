import "server-only";

import { and, count, desc, eq, gte, sum } from "drizzle-orm";

import { db } from "@repo/database";
import { generation } from "@repo/database/schema";

export async function getUserRecentGenerations(userId: string, limit = 5) {
  return db
    .select()
    .from(generation)
    .where(
      and(eq(generation.userId, userId), eq(generation.status, "completed"))
    )
    .orderBy(desc(generation.createdAt))
    .limit(limit);
}

export async function getGenerationById(id: string) {
  const rows = await db
    .select()
    .from(generation)
    .where(eq(generation.id, id))
    .limit(1);
  return rows[0] || null;
}

export async function getUserGenerations(
  userId: string,
  opts?: { limit?: number; offset?: number; status?: string }
) {
  const conditions = [eq(generation.userId, userId)];
  if (opts?.status) {
    conditions.push(
      eq(generation.status, opts.status as "pending" | "completed" | "failed")
    );
  }

  return db
    .select()
    .from(generation)
    .where(and(...conditions))
    .orderBy(desc(generation.createdAt))
    .limit(opts?.limit || 20)
    .offset(opts?.offset || 0);
}

export async function getUserGenerationsCount(userId: string, status?: string) {
  const conditions = [eq(generation.userId, userId)];
  if (status) {
    conditions.push(
      eq(generation.status, status as "pending" | "completed" | "failed")
    );
  }

  const result = await db
    .select({ count: count() })
    .from(generation)
    .where(and(...conditions));
  return result[0]?.count || 0;
}

export async function getGenerationStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [totalResult, todayResult, completedResult, creditsResult] =
    await Promise.all([
      db.select({ count: count() }).from(generation),
      db
        .select({ count: count() })
        .from(generation)
        .where(gte(generation.createdAt, todayStart)),
      db
        .select({ count: count() })
        .from(generation)
        .where(eq(generation.status, "completed")),
      db.select({ total: sum(generation.creditsConsumed) }).from(generation),
    ]);

  return {
    total: totalResult[0]?.count || 0,
    today: todayResult[0]?.count || 0,
    completed: completedResult[0]?.count || 0,
    creditsConsumed: Number(creditsResult[0]?.total) || 0,
  };
}
