"use client";

import { formatCredits } from "@repo/shared/credits/format";
import { formatDateInTimeZone } from "@repo/shared/time-zone";
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
import dynamic from "next/dynamic";
import type {
  LightboxReferenceImage,
  LightboxGeneration,
} from "@/features/image-generation/components/image-lightbox";

// 懒加载:lightbox(大图查看模态)仅在点开某张图时才需要,改 next/dynamic 后从列表页
// 首屏 bundle 移出,点开时再异步加载。
const ImageLightbox = dynamic(
  () =>
    import("@/features/image-generation/components/image-lightbox").then(
      (m) => m.ImageLightbox
    ),
  { ssr: false }
);
import type { GenerationCreditDetails } from "@/features/image-generation/credit-calculation-details";

export interface HistoryGeneration {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  promptRepairNotice?: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  creditDetails: GenerationCreditDetails | null;
  status: "pending" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  storageKey: string | null;
  storageBucket: string | null;
  imageUrl: string | null;
  referenceImages?: LightboxReferenceImage[];
}

export interface HistoryClientProps {
  initialGenerations: HistoryGeneration[];
  totalCount: number;
  page: number;
  pageSize: number;
  timeZone: string;
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

function formatDate(iso: string, locale: string, timeZone: string): string {
  try {
    return formatDateInTimeZone(
      iso,
      locale,
      {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      },
      timeZone
    );
  } catch {
    return iso;
  }
}

function creditSummary(
  item: HistoryGeneration,
  copy: (en: string, zh: string) => string
) {
  const details = item.creditDetails;
  if (!details) return null;
  const parts = [];
  if (details.actualImageCredits !== null) {
    parts.push(
      `${copy("image", "图片")} ${formatCredits(details.actualImageCredits)}`
    );
  }
  if (details.chatCredits !== null && details.chatCredits > 0) {
    parts.push(
      `${copy("conversation", "对话")} ${formatCredits(details.chatCredits)}`
    );
  }
  if (details.billingMultiplier !== 1) {
    parts.push(
      `${copy("multiplier", "倍率")} x${Number(
        details.billingMultiplier.toFixed(4)
      )}`
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

export function HistoryClient({
  initialGenerations,
  totalCount,
  page,
  pageSize,
  timeZone,
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
  const historyHref = (nextPage: number) =>
    `/${locale}/dashboard/history?page=${nextPage}`;
  const createHref = `/${locale}/dashboard/create`;

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
          <Link href={createHref}>{copy("Create an image", "创建图片")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="hidden grid-cols-[64px_minmax(0,1fr)_150px_90px_118px_92px_128px] items-center gap-3 border-b border-border bg-muted/30 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:grid">
          <div>{copy("Image", "图片")}</div>
          <div>{copy("Prompt", "提示词")}</div>
          <div>{copy("Model", "模型")}</div>
          <div>{copy("Size", "尺寸")}</div>
          <div>{copy("Credits", "积分")}</div>
          <div>{copy("Status", "状态")}</div>
          <div>{copy("Date", "日期")}</div>
        </div>

        <ul className="divide-y divide-border">
          {items.map((item) => {
            const summary = creditSummary(item, copy);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="grid w-full grid-cols-[56px_minmax(0,1fr)] items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 md:grid-cols-[64px_minmax(0,1fr)_150px_90px_118px_92px_128px] md:items-center md:gap-3"
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-border bg-muted md:h-14 md:w-14">
                    {item.imageUrl && item.status === "completed" ? (
                      <Image
                        // 列表缩略图(56–64px):对同源存储图请求 w=128 的小图,避免下整图
                        // (平均 2.4MB)。与 ImageCard 同款,消除“点历史发卡”的残留来源。
                        src={
                          item.imageUrl.startsWith("/api/storage/")
                            ? `${item.imageUrl}${item.imageUrl.includes("?") ? "&" : "?"}w=128`
                            : item.imageUrl
                        }
                        alt={item.prompt}
                        fill
                        sizes="64px"
                        className="object-contain"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-5 w-5" strokeWidth={1.2} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="line-clamp-2 break-words text-sm leading-snug text-foreground">
                      {item.prompt}
                    </p>
                    {item.error ? (
                      <p className="mt-1 line-clamp-2 break-words text-xs leading-snug text-destructive">
                        {item.error}
                      </p>
                    ) : null}
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
                    {summary && (
                      <p className="mt-1 text-[11px] leading-tight text-muted-foreground md:hidden">
                        {summary}
                      </p>
                    )}
                  </div>

                  <div
                    className="hidden min-w-0 truncate font-mono text-xs text-foreground md:block"
                    title={item.model}
                  >
                    {item.model}
                  </div>
                  <div className="hidden font-mono text-xs text-foreground md:block">
                    {item.size}
                  </div>
                  <div className="hidden text-xs text-foreground md:block">
                    {formatCredits(item.creditsConsumed)}
                    {summary && (
                      <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
                        {summary}
                      </span>
                    )}
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
                    <span className="truncate">
                      {formatDate(item.createdAt, locale, timeZone)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
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
                <Link href={historyHref(page - 1)}>
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
                <Link href={historyHref(page + 1)}>
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
          timeZone={timeZone}
          onClose={() => setSelectedId(null)}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}
