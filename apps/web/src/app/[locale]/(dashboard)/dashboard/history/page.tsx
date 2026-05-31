import { count, desc, eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { HistoryClient } from "@/features/image-generation/components/history-client";
import { extractGenerationCreditDetails } from "@/features/image-generation/credit-calculation-details";
import {
  extractGenerationReferenceImages,
  extractPromptRepairNotice,
  toStoredImageUrl,
} from "@/features/image-generation/generation-metadata";
import { getCurrentUser } from "@repo/shared/auth/server";
import { getAppTimeZone } from "@repo/shared/time-zone/server";

interface HistoryPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/sign-in`);
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  const params = await searchParams;
  const PAGE_SIZE = 20;
  const pageParam = Number(params.page);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [generations, totalResult, timeZone] = await Promise.all([
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
    getAppTimeZone(),
  ]);

  const withUrls = generations.map((g) => ({
    id: g.id,
    prompt: g.prompt,
    revisedPrompt: g.revisedPrompt,
    promptRepairNotice: extractPromptRepairNotice(g.metadata),
    model: g.model,
    size: g.size,
    status: g.status,
    creditsConsumed: g.creditsConsumed,
    creditDetails: extractGenerationCreditDetails(
      g.metadata,
      g.creditsConsumed
    ),
    error: g.error,
    storageKey: g.storageKey,
    storageBucket: g.storageBucket,
    imageUrl: toStoredImageUrl(g.storageBucket, g.storageKey),
    referenceImages: extractGenerationReferenceImages(g.metadata),
    createdAt: g.createdAt.toISOString(),
  }));

  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {copy("History", "历史记录")}
        </h1>
        <p className="text-muted-foreground">
          {copy(
            "All generations, including failed and pending",
            "所有生成记录，包括失败和处理中的任务"
          )}
        </p>
      </div>
      <HistoryClient
        key={page}
        initialGenerations={withUrls}
        totalCount={totalResult[0]?.count ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        timeZone={timeZone}
      />
    </div>
  );
}
