import { and, count, desc, eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { GalleryClient } from "@/features/image-generation/components/gallery-client";
import { getCurrentUser } from "@repo/shared/auth/server";

export default async function GalleryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const locale = await getLocale();
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  const PAGE_SIZE = 20;

  const [generations, totalResult] = await Promise.all([
    db
      .select()
      .from(generation)
      .where(
        and(eq(generation.userId, user.id), eq(generation.status, "completed"))
      )
      .orderBy(desc(generation.createdAt))
      .limit(PAGE_SIZE),
    db
      .select({ count: count() })
      .from(generation)
      .where(
        and(eq(generation.userId, user.id), eq(generation.status, "completed"))
      ),
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
          {copy("Gallery", "图库")}
        </h1>
        <p className="text-muted-foreground">
          {copy("Your generated images", "你生成的图片")}
        </p>
      </div>
      <GalleryClient
        initialGenerations={withUrls}
        totalCount={totalResult[0]?.count ?? 0}
      />
    </div>
  );
}
