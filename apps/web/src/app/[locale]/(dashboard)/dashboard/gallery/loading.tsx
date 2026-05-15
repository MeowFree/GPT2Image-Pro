import { Card } from "@repo/ui/components/card";

export default function GalleryLoading() {
  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      <div className="space-y-2">
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={`gallery-skeleton-${i.toString()}`}>
            <Card className="overflow-hidden border-border shadow-none">
              <div className="aspect-square w-full animate-pulse bg-muted" />
              <div className="space-y-2 p-3">
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                <div className="flex items-center justify-between pt-1">
                  <div className="h-4 w-14 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-10 animate-pulse rounded bg-muted" />
                </div>
              </div>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
