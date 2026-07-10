export default function HistoryLoading() {
  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      {/* 骨架结构对齐 history/page.tsx 最终布局(标题 + 表格式列表:表头条 + 数据行),
          避免加载完成后的布局跳动;脉动收敛在外层统一驱动,并尊重减弱动态设置 */}
      <div className="animate-pulse space-y-8 motion-reduce:animate-none">
        <div className="space-y-2">
          <div className="h-7 w-32 rounded-sm bg-muted" />
          <div className="h-4 w-64 rounded-sm bg-muted" />
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="hidden border-b border-border bg-muted/30 px-4 py-3 md:block">
            <div className="h-3.5 w-full max-w-md rounded-sm bg-muted" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`history-skeleton-${i.toString()}`}
                className="flex items-center gap-4 px-4 py-3"
              >
                <div className="h-12 w-12 shrink-0 rounded-sm bg-muted md:h-14 md:w-14" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 rounded-sm bg-muted" />
                  <div className="h-3 w-1/2 rounded-sm bg-muted" />
                </div>
                <div className="hidden h-4 w-16 rounded-full bg-muted md:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
