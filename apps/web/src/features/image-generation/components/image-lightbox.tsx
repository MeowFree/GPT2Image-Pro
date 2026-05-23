"use client";

import { formatCredits } from "@repo/shared/credits/format";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/components/dialog";
import { Separator } from "@repo/ui/components/separator";
import {
  Download,
  GripVertical,
  ImageIcon,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { type PointerEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { deleteGenerationAction } from "@/features/image-generation/actions";

export interface LightboxGeneration {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  error?: string | null;
  createdAt: string;
}

export interface ImageLightboxProps {
  generation: LightboxGeneration;
  imageUrl: string | null;
  open: boolean;
  onClose: () => void;
  onDelete?: (id: string) => void;
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

export function ImageLightbox({
  generation,
  imageUrl,
  open,
  onClose,
  onDelete,
}: ImageLightboxProps) {
  const locale = useLocale();
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const statusLabel = (status: string) =>
    isZh ? STATUS_LABELS_ZH[status] || status : status;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState(44);
  const dragState = useRef<{
    startX: number;
    startWidth: number;
    containerWidth: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const createReferenceHref = (mode: "image" | "chat") => {
    if (!imageUrl) return `/${locale}/dashboard/create`;
    const params = new URLSearchParams({
      mode,
      ref: imageUrl,
      sourceId: generation.id,
      sourceName: `gpt2image-${generation.id}`,
    });
    return `/${locale}/dashboard/create?${params.toString()}`;
  };

  const { execute: executeDelete, isExecuting: isDeleting } = useAction(
    deleteGenerationAction,
    {
      onSuccess: () => {
        toast.success(copy("Image deleted", "图片已删除"));
        onDelete?.(generation.id);
        setConfirmDelete(false);
        onClose();
      },
      onError: ({ error }) => {
        const message =
          error?.serverError ||
          error?.validationErrors?._errors?.[0] ||
          copy("Failed to delete image", "删除图片失败");
        toast.error(
          typeof message === "string"
            ? message
            : copy("Failed to delete image", "删除图片失败")
        );
      },
    }
  );

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    executeDelete({ generationId: generation.id });
  };

  const handleResizeStart = (event: PointerEvent<HTMLButtonElement>) => {
    const container = containerRef.current;
    if (!container) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      startX: event.clientX,
      startWidth: detailsWidth,
      containerWidth: container.getBoundingClientRect().width,
    };
  };

  const handleResizeMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (!state) return;
    const deltaPercent =
      ((state.startX - event.clientX) / state.containerWidth) * 100;
    const nextWidth = Math.min(
      58,
      Math.max(30, state.startWidth + deltaPercent)
    );
    setDetailsWidth(nextWidth);
  };

  const handleResizeEnd = (event: PointerEvent<HTMLButtonElement>) => {
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setConfirmDelete(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-6xl gap-0 overflow-y-auto border-border bg-background p-0 md:overflow-hidden">
        <DialogTitle className="sr-only">
          {copy("Image details", "图片详情")}
        </DialogTitle>
        <div
          ref={containerRef}
          className="grid grid-cols-1 md:flex md:max-h-[92vh] md:min-h-[560px]"
        >
          <div
            className="relative aspect-square w-full shrink overflow-hidden bg-muted md:aspect-auto"
            style={{
              flexBasis: `calc(${100 - detailsWidth}% - 6px)`,
            }}
          >
            {imageUrl && generation.status === "completed" ? (
              <Image
                src={imageUrl}
                alt={generation.prompt}
                fill
                sizes="(max-width: 768px) 100vw, 60vw"
                className="object-contain"
                unoptimized={!imageUrl.startsWith("/api/storage/")}
              />
            ) : (
              <div className="flex h-full min-h-[320px] w-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-16 w-16" strokeWidth={1} />
              </div>
            )}
          </div>

          <button
            type="button"
            aria-label={copy("Resize details panel", "调整详情面板宽度")}
            className="group hidden w-3 shrink-0 cursor-col-resize items-center justify-center border-x border-border bg-muted/40 transition-colors hover:bg-muted md:flex"
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            style={{ touchAction: "none" }}
          >
            <span className="flex h-12 w-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border transition-colors group-hover:text-foreground">
              <GripVertical className="h-4 w-4" />
            </span>
          </button>

          <div
            className="flex min-h-0 w-full min-w-0 flex-col md:shrink-0"
            style={{ flexBasis: `calc(${detailsWidth}% - 6px)` }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                    {copy("Prompt", "提示词")}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap font-serif text-base leading-relaxed text-foreground">
                    {generation.prompt}
                  </p>
                </div>

                {generation.revisedPrompt &&
                  generation.revisedPrompt !== generation.prompt && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                        {copy("Revised Prompt", "优化提示词")}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        {generation.revisedPrompt}
                      </p>
                    </div>
                  )}

                {generation.status === "failed" && generation.error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-widest text-destructive">
                      {copy("Error", "错误")}
                    </p>
                    <p className="mt-1 text-sm text-destructive">
                      {generation.error}
                    </p>
                  </div>
                )}

                <Separator />

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {copy("Model", "模型")}
                    </dt>
                    <dd className="mt-0.5 font-mono text-xs text-foreground">
                      {generation.model}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {copy("Size", "尺寸")}
                    </dt>
                    <dd className="mt-0.5 font-mono text-xs text-foreground">
                      {generation.size}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {copy("Credits", "积分")}
                    </dt>
                    <dd className="mt-0.5 text-xs text-foreground">
                      {formatCredits(generation.creditsConsumed)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {copy("Status", "状态")}
                    </dt>
                    <dd className="mt-0.5">
                      <Badge
                        variant="outline"
                        className="rounded-full border-border font-normal text-[10px] uppercase tracking-wide"
                      >
                        {statusLabel(generation.status)}
                      </Badge>
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {copy("Created", "创建时间")}
                    </dt>
                    <dd className="mt-0.5 text-xs text-foreground">
                      {formatDate(generation.createdAt, locale)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border bg-background p-6">
              {imageUrl && generation.status === "completed" && (
                <>
                  <Button asChild className="w-full justify-center">
                    <Link href={createReferenceHref("image")}>
                      <Send className="mr-2 h-4 w-4" />
                      {copy("Send to image edit", "发送到图生图")}
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full justify-center"
                  >
                    <Link href={createReferenceHref("chat")}>
                      <MessageSquare className="mr-2 h-4 w-4" />
                      {copy("Send to chat", "发送到 Chat")}
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full justify-center"
                  >
                    <a
                      href={imageUrl}
                      download={`gpt2image-${generation.id}.png`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {copy("Download", "下载")}
                    </a>
                  </Button>
                </>
              )}
              {onDelete && (
                <Button
                  variant={confirmDelete ? "destructive" : "ghost"}
                  className="w-full justify-center"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  {confirmDelete
                    ? copy("Click again to confirm", "再次点击确认删除")
                    : copy("Delete", "删除")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
