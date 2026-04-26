"use client";

import { Download, ImageIcon, Loader2, Trash2 } from "lucide-react";
import Image from "next/image";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/components/dialog";
import { Separator } from "@repo/ui/components/separator";
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { execute: executeDelete, isExecuting: isDeleting } = useAction(
    deleteGenerationAction,
    {
      onSuccess: () => {
        toast.success("Image deleted");
        onDelete?.(generation.id);
        setConfirmDelete(false);
        onClose();
      },
      onError: ({ error }) => {
        const message =
          error?.serverError ||
          error?.validationErrors?._errors?.[0] ||
          "Failed to delete image";
        toast.error(
          typeof message === "string" ? message : "Failed to delete image"
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
      <DialogContent className="max-w-5xl gap-0 border-border bg-background p-0">
        <DialogTitle className="sr-only">Image details</DialogTitle>
        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
          <div className="relative aspect-square w-full overflow-hidden bg-muted md:aspect-auto md:min-h-[520px]">
            {imageUrl && generation.status === "completed" ? (
              <Image
                src={imageUrl}
                alt={generation.prompt}
                fill
                sizes="(max-width: 768px) 100vw, 60vw"
                className="object-contain"
                unoptimized
              />
            ) : (
              <div className="flex h-full min-h-[320px] w-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-16 w-16" strokeWidth={1} />
              </div>
            )}
          </div>

          <div className="flex flex-col p-6">
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  Prompt
                </p>
                <p className="mt-1 whitespace-pre-wrap font-serif text-base leading-relaxed text-foreground">
                  {generation.prompt}
                </p>
              </div>

              {generation.revisedPrompt &&
                generation.revisedPrompt !== generation.prompt && (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                      Revised Prompt
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                      {generation.revisedPrompt}
                    </p>
                  </div>
                )}

              {generation.status === "failed" && generation.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-destructive">
                    Error
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
                    Model
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs text-foreground">
                    {generation.model}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Size
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs text-foreground">
                    {generation.size}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Credits
                  </dt>
                  <dd className="mt-0.5 text-xs text-foreground">
                    {generation.creditsConsumed}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Status
                  </dt>
                  <dd className="mt-0.5">
                    <Badge
                      variant="outline"
                      className="rounded-full border-border font-normal text-[10px] uppercase tracking-wide"
                    >
                      {generation.status}
                    </Badge>
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Created
                  </dt>
                  <dd className="mt-0.5 text-xs text-foreground">
                    {formatDate(generation.createdAt)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-auto flex flex-col gap-2 pt-6">
              {imageUrl && generation.status === "completed" && (
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
                    Download
                  </a>
                </Button>
              )}
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
                {confirmDelete ? "Click again to confirm" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
