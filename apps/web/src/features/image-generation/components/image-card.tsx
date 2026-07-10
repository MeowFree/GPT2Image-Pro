"use client";

import { buildStorageThumbnailUrl } from "@repo/shared/storage/image-url";
import { formatDateInTimeZone } from "@repo/shared/time-zone";
import { Badge } from "@repo/ui/components/badge";
import { Card } from "@repo/ui/components/card";
import { Check, Clock, Download, ImageIcon } from "lucide-react";
import Image from "next/image";
import { useLocale } from "next-intl";
import { generateDownloadFilename } from "@/lib/download-filename";

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
  /** 是否处于多选模式 */
  selectable?: boolean;
  /** 当前卡片是否被选中 */
  selected?: boolean;
  /** 选中/取消选中回调,参数为 generation id 与原始鼠标事件(用于 Shift 范围选) */
  onSelect?: (id: string, event: React.MouseEvent) => void;
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
  id,
  prompt,
  imageUrl,
  model,
  size,
  status,
  createdAt,
  badge,
  timeZone,
  onClick,
  selectable,
  selected,
  onSelect,
}: ImageCardProps) {
  const locale = useLocale();
  const copy = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const clickable = Boolean(onClick) || Boolean(selectable);
  // 列表缩略图:对同源存储图(/api/storage)请求按需缩放后的小图(w=640),把全分辨率
  // 大图(平均 2.4MB)降到缩略图尺寸,大幅降低列表的下载/解码/内存占用。宽度走"路径段"
  // (而非 ?w= 查询参数),以绕过 Cloudflare 忽略 query 的边缘缓存键——否则会命中并下回
  // 整张原图、挤占 HTTP/2 连接带宽、饿死导航请求。非存储图(外链回退)保持原样。
  const thumbnailUrl = buildStorageThumbnailUrl(imageUrl, 640);

  // 多选模式下点击整张卡片触发选中切换,并传递鼠标事件以支持 Shift 范围选;
  // 非多选模式走原有 onClick
  const handleCardClick = (e: React.MouseEvent) => {
    if (selectable && onSelect) {
      onSelect(id, e);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <Card
      onClick={handleCardClick}
      className={`group gap-0 overflow-hidden rounded-lg border border-border bg-background p-0 shadow-none transition-[transform,box-shadow] duration-250 motion-reduce:transition-none ${
        clickable
          ? "cursor-pointer hover:-translate-y-1 hover:shadow-whisper"
          : ""
      } ${selected ? "ring-2 ring-primary" : ""}`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {thumbnailUrl && status === "completed" ? (
          <Image
            src={thumbnailUrl}
            alt={prompt}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain transition-transform duration-400 group-hover:scale-[1.03] motion-reduce:transition-none"
            unoptimized
            // 低优先级:与导航 RSC 共用同一条 HTTP/2 连接时,让浏览器优先把带宽给
            // 用户点击触发的导航请求,避免一屏缩略图把切页/切 Tab 拖住。
            fetchPriority="low"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-10 w-10" strokeWidth={1.2} />
          </div>
        )}
        {/* hover 遮罩(对齐参考实现):整卡深色遮罩淡入,承载尺寸徽标与下载按钮。
            多选模式下点击语义是"选中",不展示遮罩,避免与复选交互冲突;
            visibility 联动过渡,保证隐藏时下载链接不可点击(透明命中区会误触下载) */}
        {!selectable && status === "completed" && imageUrl && (
          <div className="invisible absolute inset-0 bg-black/40 opacity-0 transition-[opacity,visibility] duration-250 group-hover:visible group-hover:opacity-100 motion-reduce:transition-none">
            <span className="absolute bottom-2.5 left-2.5 rounded-[5px] bg-black/55 px-2 py-0.5 text-xs text-white/70 backdrop-blur-sm">
              {size}
            </span>
            <a
              href={imageUrl}
              download={generateDownloadFilename(prompt, createdAt)}
              onClick={(e) => e.stopPropagation()}
              title={copy("Download", "下载")}
              aria-label={copy("Download", "下载")}
              className="absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-[9px] border border-white/15 bg-black/60 text-white/85 backdrop-blur-sm transition-colors duration-150 hover:border-white/30 hover:bg-black/80"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
        {/* 多选复选框:多选模式下始终显示,非多选模式下仅 hover 或已选中时显示 */}
        {(selectable || selected) && (
          <div
            className={`absolute left-2.5 top-2.5 z-10 ${
              selectable
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100"
            } transition-opacity duration-150`}
          >
            <div
              className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                selected
                  ? "border-primary bg-primary"
                  : "border-border bg-background/80"
              }`}
            >
              {selected && (
                <Check className="h-3 w-3 text-primary-foreground" />
              )}
            </div>
          </div>
        )}
        {/* badge 位置:多选模式下移到右上角避免与复选框重叠;
            深色玻璃样式与 hover 遮罩内的尺寸徽标同一语言(图片遮罩允许的 rgba 例外) */}
        {badge && (
          <div
            className={`absolute top-2.5 ${selectable ? "right-2.5" : "left-2.5"}`}
          >
            <span className="inline-flex rounded-[5px] bg-black/55 px-2 py-0.5 text-[11px] text-white/85 backdrop-blur-sm">
              {badge}
            </span>
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
