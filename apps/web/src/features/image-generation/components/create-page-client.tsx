"use client";

import { Coins, Download, ImagePlus, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@repo/ui/components/button";
import { Textarea } from "@repo/ui/components/textarea";

import { generateImageAction } from "../actions";

type RecentGeneration = {
  id: string;
  prompt: string;
  imageUrl: string | null;
  createdAt: string;
};

type ResultState = {
  generationId: string;
  imageUrl: string;
  prompt: string;
  revisedPrompt?: string;
};

const SIZE_OPTIONS = [
  { value: "1024x1024", label: "Square (1024 × 1024)" },
  { value: "1024x1792", label: "Portrait (1024 × 1792)" },
  { value: "1792x1024", label: "Landscape (1792 × 1024)" },
];

interface CreatePageClientProps {
  balance: number;
  creditsPerImage: number;
  recentGenerations: RecentGeneration[];
}

export function CreatePageClient({
  balance: initialBalance,
  creditsPerImage,
  recentGenerations: initialRecent,
}: CreatePageClientProps) {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [balance, setBalance] = useState(initialBalance);
  const [result, setResult] = useState<ResultState | null>(null);
  const [recent, setRecent] = useState<RecentGeneration[]>(initialRecent);

  const { execute, isExecuting } = useAction(generateImageAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.error) {
        if (data.error.toLowerCase().includes("insufficient credits")) {
          toast.error("Insufficient credits", {
            description: "You don't have enough credits to generate an image.",
            action: {
              label: "Top up",
              onClick: () => {
                window.location.href = "/dashboard/credits/buy";
              },
            },
          });
        } else {
          toast.error("Generation failed", { description: data.error });
        }
        return;
      }

      if (data.imageUrl && data.generationId) {
        const newResult: ResultState = {
          generationId: data.generationId,
          imageUrl: data.imageUrl,
          prompt,
        };
        if (data.revisedPrompt) newResult.revisedPrompt = data.revisedPrompt;
        setResult(newResult);
        setBalance((b) => Math.max(0, b - (data.creditsConsumed || 0)));
        setRecent((prev) => [
          {
            id: data.generationId!,
            prompt,
            imageUrl: data.imageUrl!,
            createdAt: new Date().toISOString(),
          },
          ...prev.slice(0, 5),
        ]);
        toast.success("Image generated");
      }
    },
    onError: ({ error }) => {
      toast.error("Generation failed", {
        description: error.serverError || "An unexpected error occurred.",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error("Please enter a prompt");
      return;
    }
    if (balance < creditsPerImage) {
      toast.error("Insufficient credits", {
        action: {
          label: "Top up",
          onClick: () => {
            window.location.href = "/dashboard/credits/buy";
          },
        },
      });
      return;
    }
    setResult(null);
    execute({ prompt: prompt.trim(), size });
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <header className="mb-8 space-y-2">
        <h1 className="font-serif text-3xl font-semibold tracking-tight md:text-4xl">
          Create
        </h1>
        <p className="text-sm text-muted-foreground">
          Describe what you want, and we&apos;ll generate it for you.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mb-10 space-y-4">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to create..."
          rows={5}
          disabled={isExecuting}
          className="resize-none border-input bg-background text-base"
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <label
              htmlFor="size-select"
              className="text-sm text-muted-foreground"
            >
              Size
            </label>
            <select
              id="size-select"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              disabled={isExecuting}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Coins className="h-3.5 w-3.5" />
              <span>
                Balance:{" "}
                <span className="font-medium text-foreground">{balance}</span> ·
                Cost:{" "}
                <span className="font-medium text-foreground">
                  {creditsPerImage}
                </span>
                /image
              </span>
            </div>
            <Button
              type="submit"
              disabled={isExecuting || !prompt.trim()}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating
                </>
              ) : (
                <>
                  <ImagePlus className="mr-2 h-4 w-4" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </div>
      </form>

      {isExecuting && (
        <div className="mb-10 flex aspect-square max-w-2xl items-center justify-center rounded-lg border border-dashed bg-muted/30">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Generating your image...</p>
          </div>
        </div>
      )}

      {result && !isExecuting && (
        <section className="mb-10 space-y-4">
          <div className="relative mx-auto max-w-2xl overflow-hidden rounded-lg border bg-muted">
            <Image
              src={result.imageUrl}
              alt={result.prompt}
              width={1024}
              height={1024}
              className="h-auto w-full"
              unoptimized
            />
          </div>
          <div className="mx-auto max-w-2xl space-y-3">
            <p className="text-sm text-muted-foreground">{result.prompt}</p>
            {result.revisedPrompt && result.revisedPrompt !== result.prompt && (
              <p className="text-xs italic text-muted-foreground">
                Revised: {result.revisedPrompt}
              </p>
            )}
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={result.imageUrl}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </a>
              </Button>
            </div>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-semibold">Recent</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {recent.map((g) => (
              <Link
                key={g.id}
                href={`/dashboard/gallery/${g.id}`}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                title={g.prompt}
              >
                {g.imageUrl ? (
                  <Image
                    src={g.imageUrl}
                    alt={g.prompt}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImagePlus className="h-6 w-6" />
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
