"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { ImagePlus } from "lucide-react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useState } from "react";
import { ImageCard } from "@/features/image-generation/components/image-card";
import dynamic from "next/dynamic";
import type {
  LightboxReferenceImage,
  LightboxGeneration,
} from "@/features/image-generation/components/image-lightbox";

// 懒加载:lightbox 仅在点开某张图时才需要,改 next/dynamic 后从图库首屏 bundle 移出。
const ImageLightbox = dynamic(
  () =>
    import("@/features/image-generation/components/image-lightbox").then(
      (m) => m.ImageLightbox
    ),
  { ssr: false }
);

export interface GenerationWithUrl {
  id: string;
  parentId?: string;
  prompt: string;
  revisedPrompt: string | null;
  promptRepairNotice?: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  storageKey: string | null;
  storageBucket: string | null;
  imageUrl: string | null;
  outputRole?: "final" | "agent_draft" | "upload";
  referenceImages?: LightboxReferenceImage[];
  isLayered?: boolean;
}

export interface GalleryClientProps {
  initialGenerations: GenerationWithUrl[];
  totalCount: number;
  finalCount: number;
  draftCount: number;
  uploadCount: number;
  activeTab: "final" | "agent-drafts" | "uploads";
  page: number;
  timeZone: string;
}

export function GalleryClient({
  initialGenerations,
  totalCount,
  finalCount,
  draftCount,
  uploadCount,
  activeTab,
  page,
  timeZone,
}: GalleryClientProps) {
  const locale = useLocale();
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const [items, setItems] = useState<GenerationWithUrl[]>(initialGenerations);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const hasMore = items.length < totalCount;
  const createHref = `/${locale}/dashboard/create`;
  const galleryHref = (tab: GalleryClientProps["activeTab"], nextPage = 1) =>
    `/${locale}/dashboard/gallery?tab=${tab}&page=${nextPage}`;
  const nextPageHref = galleryHref(activeTab, page + 1);
  const countBadgeClass = (active: boolean) =>
    [
      "ml-2 rounded-full px-1.5 py-0 text-[10px] font-normal",
      active
        ? "border-transparent bg-primary-foreground text-primary"
        : "border-border text-foreground",
    ].join(" ");

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  const tabs = (
    <Tabs value={activeTab} className="w-full">
      <TabsList className="h-auto flex-wrap justify-start border border-border bg-muted/40">
        <TabsTrigger value="final" asChild>
          <Link href={galleryHref("final")} scroll={false}>
            {copy("Final images", "成品")}
            <Badge
              variant="outline"
              className={countBadgeClass(activeTab === "final")}
            >
              {finalCount}
            </Badge>
          </Link>
        </TabsTrigger>
        <TabsTrigger value="agent-drafts" asChild>
          <Link href={galleryHref("agent-drafts")} scroll={false}>
            {copy("Agent drafts", "Agent 中间图")}
            <Badge
              variant="outline"
              className={countBadgeClass(activeTab === "agent-drafts")}
            >
              {draftCount}
            </Badge>
          </Link>
        </TabsTrigger>
        <TabsTrigger value="uploads" asChild>
          <Link href={galleryHref("uploads")} scroll={false}>
            {copy("User uploads", "用户上传图")}
            <Badge
              variant="outline"
              className={countBadgeClass(activeTab === "uploads")}
            >
              {uploadCount}
            </Badge>
          </Link>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        {tabs}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 py-24 text-center">
          <ImagePlus
            className="h-10 w-10 text-muted-foreground"
            strokeWidth={1.2}
          />
          <h3 className="mt-4 font-serif text-lg font-medium text-foreground">
            {activeTab === "agent-drafts"
              ? copy("No Agent drafts yet", "还没有 Agent 中间图")
              : activeTab === "uploads"
                ? copy("No user uploads yet", "还没有用户上传图")
                : copy("No images yet", "还没有图片")}
          </h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {activeTab === "agent-drafts"
              ? copy(
                  "Intermediate images from Agent iterations will appear here.",
                  "Agent 自动迭代产生的中间图会显示在这里。"
                )
              : activeTab === "uploads"
                ? copy(
                    "Reference images uploaded for image edits and chats will appear here.",
                    "图生图和 Chat 上传的参考图会显示在这里。"
                  )
                : copy(
                    "Your generated images will appear here. Start by creating your first one.",
                    "你生成的图片会显示在这里。先创建第一张图片吧。"
                  )}
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href={createHref}>{copy("Create an image", "创建图片")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-5">{tabs}</div>
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
              timeZone={timeZone}
              onClick={() => setSelectedId(item.id)}
              badge={
                item.outputRole === "agent_draft"
                  ? copy("Draft", "中间图")
                  : item.outputRole === "upload"
                    ? copy("Upload", "上传")
                    : undefined
              }
            />
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button asChild variant="outline">
            <Link href={nextPageHref} scroll={false}>
              {copy("Load more", "加载更多")}
            </Link>
          </Button>
        </div>
      )}

      {selected && (
        <ImageLightbox
          generation={selected as LightboxGeneration}
          imageUrl={selected.imageUrl}
          open={selectedId !== null}
          timeZone={timeZone}
          onClose={() => setSelectedId(null)}
          onDelete={
            selected.outputRole === "agent_draft" ||
            selected.outputRole === "upload"
              ? undefined
              : handleDelete
          }
        />
      )}
    </>
  );
}
