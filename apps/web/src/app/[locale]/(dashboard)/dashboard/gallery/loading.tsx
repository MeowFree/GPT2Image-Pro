export default function GalleryLoading() {
  return (
    <div className="container mx-auto space-y-8 px-4 py-6 md:px-6">
      {/* 骨架结构对齐 gallery/page.tsx 最终布局(标题 + tabs 条 + 4 列卡片网格),
          避免加载完成后的布局跳动;脉动收敛在外层统一驱动,并尊重减弱动态设置 */}
      <div className="animate-pulse space-y-8 motion-reduce:animate-none">
        <div className="space-y-2">
          <div className="h-7 w-32 rounded-sm bg-muted" />
          <div className="h-4 w-48 rounded-sm bg-muted" />
        </div>

        <div className="space-y-5">
          <div className="h-10 w-full max-w-xl rounded-md bg-muted" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`gallery-skeleton-${i.toString()}`}
                className="overflow-hidden rounded-lg border border-border bg-background"
              >
                <div className="aspect-square w-full bg-muted" />
                <div className="space-y-2 p-3">
                  <div className="h-3 w-full rounded-sm bg-muted" />
                  <div className="h-3 w-2/3 rounded-sm bg-muted" />
                  <div className="flex items-center justify-between pt-1">
                    <div className="h-4 w-14 rounded-full bg-muted" />
                    <div className="h-3 w-10 rounded-sm bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
