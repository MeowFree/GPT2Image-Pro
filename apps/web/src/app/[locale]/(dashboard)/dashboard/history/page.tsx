import { count, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { HistoryClient } from "@/features/image-generation/components/history-client";
import { getCurrentUser } from "@repo/shared/auth/server";

interface HistoryPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const params = await searchParams;
  const PAGE_SIZE = 20;
  const pageParam = Number(params.page);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [generations, totalResult] = await Promise.all([
    db
      .select()
      .from(generation)
      .where(eq(generation.userId, user.id))
      .orderBy(desc(generation.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ count: count() })
      .from(generation)
      .where(eq(generation.userId, user.id)),
  ]);

  const endpoint = process.env.STORAGE_ENDPOINT;

  const withUrls = generations.map((g) => ({
    id: g.id,
    prompt: g.prompt,
    revisedPrompt: g.revisedPrompt,
    model: g.model,
    size: g.size,
    status: g.status,
    creditsConsumed: g.creditsConsumed,
    error: g.error,
    storageKey: g.storageKey,
    storageBucket: g.storageBucket,
    imageUrl: g.storageKey
      ? endpoint
        ? `/image-proxy/${g.storageBucket}/${g.storageKey}`
        : `/api/storage/${g.storageBucket}/${g.storageKey}`
      : null,
    createdAt: g.createdAt.toISOString(),
  }));

  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          History
        </h1>
        <p className="text-muted-foreground">
          All generations, including failed and pending
        </p>
      </div>
      <HistoryClient
        initialGenerations={withUrls}
        totalCount={totalResult[0]?.count ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
