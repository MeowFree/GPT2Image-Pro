"use client";

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
  onClick?: () => void;
}

function formatCreatedDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso));
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
  onClick,
}: ImageCardProps) {
  const locale = useLocale();
  const clickable = Boolean(onClick);

  return (
    <Card
      onClick={onClick}
      className={`group overflow-hidden rounded-lg border border-border bg-background shadow-none transition-all duration-200 ${
        clickable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : ""
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {imageUrl && status === "completed" ? (
          <Image
            src={imageUrl}
            alt={prompt}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-10 w-10" strokeWidth={1.2} />
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
            {formatCreatedDate(createdAt, locale)}
          </span>
        </div>
      </div>
    </Card>
  );
}
