"use client";

import { formatDateInTimeZone } from "@repo/shared/time-zone";
import { Badge } from "@repo/ui/components/badge";
import { Card } from "@repo/ui/components/card";
import { Clock, ImageIcon } from "lucide-react";
import Image from "next/image";
import { useLocale } from "next-intl";

export interface ImageCardProps {
  id: string;
  prompt: string;
  imageUrl: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  createdAt: string;
  status: "pending" | "completed" | "failed";
  badge?: string;
  timeZone?: string;
  onClick?: () => void;
}

function formatCreatedDate(
  iso: string,
  locale: string,
  timeZone?: string
): string {
  try {
    return formatDateInTimeZone(
      iso,
      locale,
      {
        month: "short",
        day: "2-digit",
        year: "numeric",
      },
      timeZone
    );
  } catch {
    return iso;
  }
}

export function ImageCard({
  prompt,
  imageUrl,
  model,
  status,
  createdAt,
  badge,
  timeZone,
  onClick,
}: ImageCardProps) {
  const locale = useLocale();
  const clickable = Boolean(onClick);
  // 列表缩略图:对同源存储图(/api/storage)请求按需缩放后的小图(w=640),把全分辨率
  // 大图(平均 2.4MB)降到缩略图尺寸,大幅降低列表的下载/解码/内存占用——这是“点历史/
  // 图库后整体发卡”的主因。非存储图(外链回退)保持原样,附加参数无副作用。
  const thumbnailUrl =
    imageUrl?.startsWith("/api/storage/")
      ? `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}w=640`
      : imageUrl;

  return (
    <Card
      onClick={onClick}
      className={`group overflow-hidden rounded-lg border border-border bg-background shadow-none transition-all duration-200 ${
        clickable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {thumbnailUrl && status === "completed" ? (
          <Image
            src={thumbnailUrl}
            alt={prompt}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-10 w-10" strokeWidth={1.2} />
          </div>
        )}
        {badge && (
          <div className="absolute left-2 top-2">
            <Badge className="rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
              {badge}
            </Badge>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="line-clamp-2 text-sm leading-snug text-foreground">
          {prompt}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant="outline"
            className="rounded-full border-border font-normal text-[10px] uppercase tracking-wide"
          >
            {model}
          </Badge>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatCreatedDate(createdAt, locale, timeZone)}
          </span>
        </div>
      </div>
    </Card>
  );
}
