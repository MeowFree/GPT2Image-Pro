"use client";

import { useState } from "react";
import { ImageCard } from "@/features/image-generation/components/image-card";
import dynamic from "next/dynamic";
import type { LightboxGeneration } from "@/features/image-generation/components/image-lightbox";

// 懒加载:lightbox 仅在点开某张图时才需要,改 next/dynamic 后从首屏 bundle 移出。
const ImageLightbox = dynamic(
  () =>
    import("@/features/image-generation/components/image-lightbox").then(
      (m) => m.ImageLightbox
    ),
  { ssr: false }
);

export interface RecentCreation {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  storageKey: string | null;
  storageBucket: string | null;
  imageUrl: string | null;
  isLayered?: boolean;
}

export function RecentCreationsClient({
  initialGenerations,
  timeZone,
}: {
  initialGenerations: RecentCreation[];
  timeZone: string;
}) {
  const [items, setItems] = useState<RecentCreation[]>(initialGenerations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <ImageCard
            key={item.id}
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
          />
        ))}
      </div>

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
