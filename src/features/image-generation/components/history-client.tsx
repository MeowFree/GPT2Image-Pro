"use client";

import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ImageIcon,
  ImagePlus,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
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
          No history yet
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Your generation history will appear here once you create images.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/dashboard/create">Create an image</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="hidden grid-cols-[64px_1fr_120px_100px_80px_100px_150px] items-center gap-4 border-b border-border bg-muted/30 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:grid">
          <div>Image</div>
          <div>Prompt</div>
          <div>Model</div>
          <div>Size</div>
          <div>Credits</div>
          <div>Status</div>
          <div>Date</div>
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
                      {item.status}
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
                  {item.creditsConsumed}
                </div>
                <div className="hidden md:block">
                  <Badge
                    variant="outline"
                    className={`rounded-full border-transparent font-normal text-[10px] uppercase tracking-wide ${statusClasses(item.status)}`}
                  >
                    {item.status}
                  </Badge>
                </div>
                <div className="hidden items-center gap-1 text-xs text-muted-foreground md:flex">
                  <Clock className="h-3 w-3" />
                  {formatDate(item.createdAt)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {totalCount} total
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
                  Previous
                </Link>
              ) : (
                <span>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
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
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Link>
              ) : (
                <span>
                  Next
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
