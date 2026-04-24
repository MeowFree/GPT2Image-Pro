import { Card } from "@/components/ui/card";

export default function HistoryLoading() {
  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      <div className="space-y-2">
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      </div>

      <Card className="overflow-hidden border-border shadow-none">
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={`history-skeleton-${i.toString()}`}
              className="flex items-center gap-4 px-4 py-3"
            >
              <div className="h-12 w-12 shrink-0 animate-pulse rounded bg-muted md:h-14 md:w-14" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
              <div className="hidden h-4 w-16 animate-pulse rounded-full bg-muted md:block" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
