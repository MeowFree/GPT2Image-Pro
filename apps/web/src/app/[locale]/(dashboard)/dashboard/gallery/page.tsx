import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { GalleryClient } from "@/features/image-generation/components/gallery-client";
import { getCurrentUser } from "@repo/shared/auth/server";

interface GalleryPageProps {
  searchParams: Promise<{ page?: string; tab?: string }>;
}

type GalleryOutputRole = "final" | "agent_draft";

function toStoredImageUrl(bucket: string | null, storageKey: string | null) {
  return storageKey
    ? `/api/storage/${bucket || "generations"}/${storageKey}`
    : null;
}

function extractAgentDraftGenerations(
  rows: Array<typeof generation.$inferSelect>
) {
  return rows.flatMap((g) => {
    const outputImage =
      g.metadata &&
      typeof g.metadata === "object" &&
      !Array.isArray(g.metadata) &&
      g.metadata.outputImage &&
      typeof g.metadata.outputImage === "object" &&
      !Array.isArray(g.metadata.outputImage)
        ? (g.metadata.outputImage as Record<string, unknown>)
        : null;
    const outputs = Array.isArray(outputImage?.imageOutputs)
      ? outputImage.imageOutputs
      : [];
    return outputs.flatMap((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const output = item as Record<string, unknown>;
      if (output.role !== "agent_draft" && output.primary !== false) return [];
      const storageKey =
        typeof output.storageKey === "string" ? output.storageKey : null;
      const generationId =
        typeof output.generationId === "string"
          ? output.generationId
          : `${g.id}-${index + 1}`;
      return [
        {
          id: generationId,
          parentId: g.id,
          prompt: g.prompt,
          revisedPrompt:
            typeof output.revisedPrompt === "string"
              ? output.revisedPrompt
              : g.revisedPrompt,
          model: g.model,
          size: typeof output.size === "string" ? output.size : g.size,
          status: g.status,
          creditsConsumed: 0,
          storageKey,
          storageBucket: g.storageBucket,
          imageUrl:
            typeof output.imageUrl === "string"
              ? output.imageUrl
              : toStoredImageUrl(g.storageBucket, storageKey),
          createdAt: g.createdAt.toISOString(),
          outputRole: "agent_draft" as GalleryOutputRole,
        },
      ];
    });
  });
}

export default async function GalleryPage({ searchParams }: GalleryPageProps) {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/sign-in`);
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  const params = await searchParams;
  const PAGE_SIZE = 20;
  const activeTab =
    params.tab === "agent-drafts" ? "agent-drafts" : ("final" as const);
  const pageParam = Number(params.page);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const limit = page * PAGE_SIZE;
  const finalCondition = and(
    eq(generation.userId, user.id),
    eq(generation.status, "completed"),
    sql`NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(${generation.metadata}::jsonb->'outputImage'->'imageOutputs', '[]'::jsonb)) AS output
      WHERE output->>'role' = 'agent_draft' AND output->>'primary' = 'true'
    )`
  );
  const draftCondition = and(
    eq(generation.userId, user.id),
    eq(generation.status, "completed"),
    isNotNull(generation.metadata),
    sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(${generation.metadata}::jsonb->'outputImage'->'imageOutputs', '[]'::jsonb)) AS output
      WHERE output->>'role' = 'agent_draft' OR output->>'primary' = 'false'
    )`
  );

  const [generations, totalResult, finalCountResult, draftParentRows] =
    await Promise.all([
      db
        .select()
        .from(generation)
        .where(activeTab === "agent-drafts" ? draftCondition : finalCondition)
        .orderBy(desc(generation.createdAt))
        .limit(limit),
      db
        .select({ count: count() })
        .from(generation)
        .where(activeTab === "agent-drafts" ? draftCondition : finalCondition),
      db
        .select({ count: count() })
        .from(generation)
        .where(finalCondition),
      db
        .select()
        .from(generation)
        .where(draftCondition)
        .orderBy(desc(generation.createdAt)),
    ]);

  const allDraftItems = extractAgentDraftGenerations(draftParentRows);
  const displayedItems =
    activeTab === "agent-drafts"
      ? allDraftItems.slice(0, limit)
      : generations.map((g) => ({
          id: g.id,
          parentId: g.id,
          prompt: g.prompt,
          revisedPrompt: g.revisedPrompt,
          model: g.model,
          size: g.size,
          status: g.status,
          creditsConsumed: g.creditsConsumed,
          storageKey: g.storageKey,
          storageBucket: g.storageBucket,
          imageUrl: toStoredImageUrl(g.storageBucket, g.storageKey),
          createdAt: g.createdAt.toISOString(),
          outputRole: "final" as GalleryOutputRole,
        }));

  const totalCount =
    activeTab === "agent-drafts"
      ? allDraftItems.length
      : totalResult[0]?.count ?? 0;
  const finalCount = finalCountResult[0]?.count ?? 0;
  const draftCount = allDraftItems.length;

  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {copy("Gallery", "图库")}
        </h1>
        <p className="text-muted-foreground">
          {copy("Your generated images", "你生成的图片")}
        </p>
      </div>
      <GalleryClient
        key={`${activeTab}-${page}`}
        initialGenerations={displayedItems}
        totalCount={totalCount}
        finalCount={finalCount}
        draftCount={draftCount}
        activeTab={activeTab}
        page={page}
      />
    </div>
  );
}
