"use client";

import { Button } from "@repo/ui/components/button";
import { ImagePlus, Loader2 } from "lucide-react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ImageCard } from "@/features/image-generation/components/image-card";
import {
  ImageLightbox,
  type LightboxGeneration,
} from "@/features/image-generation/components/image-lightbox";

export interface GenerationWithUrl {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  storageKey: string | null;
  storageBucket: string | null;
  imageUrl: string | null;
}

export interface GalleryClientProps {
  initialGenerations: GenerationWithUrl[];
  totalCount: number;
  page: number;
}

export function GalleryClient({
  initialGenerations,
  totalCount,
  page,
}: GalleryClientProps) {
  const locale = useLocale();
  const router = useRouter();
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const [items, setItems] = useState<GenerationWithUrl[]>(initialGenerations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const hasMore = items.length < totalCount;
  const createHref = `/${locale}/dashboard/create`;

  useEffect(() => {
    setItems(initialGenerations);
    setSelectedId(null);
  }, [initialGenerations]);

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    startTransition(() => {
      router.push(`/${locale}/dashboard/gallery?page=${nextPage}`, {
        scroll: false,
      });
    });
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 py-24 text-center">
        <ImagePlus
          className="h-10 w-10 text-muted-foreground"
          strokeWidth={1.2}
        />
        <h3 className="mt-4 font-serif text-lg font-medium text-foreground">
          {copy("No images yet", "还没有图片")}
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {copy(
            "Your generated images will appear here. Start by creating your first one.",
            "你生成的图片会显示在这里。先创建第一张图片吧。"
          )}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href={createHref}>{copy("Create an image", "创建图片")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.id}>
            <ImageCard
              id={item.id}
              prompt={item.prompt}
              imageUrl={item.imageUrl}
              model={item.model}
              size={item.size}
              creditsConsumed={item.creditsConsumed}
              createdAt={item.createdAt}
              status={item.status}
              onClick={() => setSelectedId(item.id)}
            />
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={handleLoadMore} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {copy("Load more", "加载更多")}
          </Button>
        </div>
      )}

      {selected && (
        <ImageLightbox
          generation={selected as LightboxGeneration}
          imageUrl={selected.imageUrl}
          open={selectedId !== null}
          onClose={() => setSelectedId(null)}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}
