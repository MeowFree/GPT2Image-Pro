"use client";

import { formatCredits } from "@repo/shared/credits/format";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ImageIcon,
  ImagePlus,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useState } from "react";
import {
  ImageLightbox,
  type LightboxGeneration,
} from "@/features/image-generation/components/image-lightbox";

export interface HistoryGeneration {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  storageKey: string | null;
  storageBucket: string | null;
  imageUrl: string | null;
}

export interface HistoryClientProps {
  initialGenerations: HistoryGeneration[];
  totalCount: number;
  page: number;
  pageSize: number;
}

function statusClasses(status: HistoryGeneration["status"]): string {
  switch (status) {
    case "completed":
      return "bg-foreground/10 text-foreground";
    case "failed":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

const STATUS_LABELS_ZH: Record<string, string> = {
  completed: "已完成",
  failed: "失败",
  pending: "处理中",
};

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function HistoryClient({
  initialGenerations,
  totalCount,
  page,
  pageSize,
}: HistoryClientProps) {
  const locale = useLocale();
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const statusLabel = (status: string) =>
    isZh ? STATUS_LABELS_ZH[status] || status : status;
  const [items, setItems] = useState<HistoryGeneration[]>(initialGenerations);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-6 py-24 text-center">
        <ImagePlus
          className="h-10 w-10 text-muted-foreground"
          strokeWidth={1.2}
        />
        <h3 className="mt-4 font-serif text-lg font-medium text-foreground">
          {copy("No history yet", "还没有历史记录")}
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {copy(
            "Your generation history will appear here once you create images.",
            "创建图片后，生成历史会显示在这里。"
          )}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/dashboard/create">
            {copy("Create an image", "创建图片")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="hidden grid-cols-[64px_1fr_120px_100px_80px_100px_150px] items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:grid">
          <div>{copy("Image", "图片")}</div>
          <div>{copy("Prompt", "提示词")}</div>
          <div>{copy("Model", "模型")}</div>
          <div>{copy("Size", "尺寸")}</div>
          <div>{copy("Credits", "积分")}</div>
          <div>{copy("Status", "状态")}</div>
          <div>{copy("Date", "日期")}</div>
        </div>

        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className="grid w-full grid-cols-[48px_1fr] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 md:grid-cols-[64px_1fr_120px_100px_80px_100px_150px] md:gap-4"
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-border bg-muted md:h-14 md:w-14">
                  {item.imageUrl && item.status === "completed" ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.prompt}
                      fill
                      sizes="64px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-5 w-5" strokeWidth={1.2} />
                    </div>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {item.prompt}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground md:hidden">
                    <span className="font-mono">{item.model}</span>
                    <span>·</span>
                    <span>{item.size}</span>
                    <span>·</span>
                    <Badge
                      variant="outline"
                      className={`rounded-full border-transparent px-2 py-0 font-normal text-[10px] uppercase ${statusClasses(item.status)}`}
                    >
                      {statusLabel(item.status)}
                    </Badge>
                  </div>
                </div>

                <div className="hidden font-mono text-xs text-foreground md:block">
                  {item.model}
                </div>
                <div className="hidden font-mono text-xs text-foreground md:block">
                  {item.size}
                </div>
                <div className="hidden text-xs text-foreground md:block">
                  {formatCredits(item.creditsConsumed)}
                </div>
                <div className="hidden md:block">
                  <Badge
                    variant="outline"
                    className={`rounded-full border-transparent font-normal text-[10px] uppercase tracking-wide ${statusClasses(item.status)}`}
                  >
                    {statusLabel(item.status)}
                  </Badge>
                </div>
                <div className="hidden items-center gap-1 text-xs text-muted-foreground md:flex">
                  <Clock className="h-3 w-3" />
                  {formatDate(item.createdAt, locale)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-xs text-muted-foreground">
            {copy(
              `Page ${page} of ${totalPages} · ${totalCount} total`,
              `第 ${page} / ${totalPages} 页 · 共 ${totalCount} 条`
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              asChild={page > 1}
              variant="outline"
              size="sm"
              disabled={page <= 1}
            >
              {page > 1 ? (
                <Link href={`/dashboard/history?page=${page - 1}`}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {copy("Previous", "上一页")}
                </Link>
              ) : (
                <span>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {copy("Previous", "上一页")}
                </span>
              )}
            </Button>
            <Button
              asChild={page < totalPages}
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
            >
              {page < totalPages ? (
                <Link href={`/dashboard/history?page=${page + 1}`}>
                  {copy("Next", "下一页")}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Link>
              ) : (
                <span>
                  {copy("Next", "下一页")}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </span>
              )}
            </Button>
          </div>
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
