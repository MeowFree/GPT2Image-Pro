/**
 * 全局状态页加载骨架屏。
 *
 * 状态页是 force-dynamic 且聚合较重(冷缓存约 3s)。没有 loading 边界时,App Router
 * 客户端导航会"阻塞"等 RSC 返回才切页——期间停留在旧页、链接像点了没反应("点不动")。
 * 此骨架在导航时立即显示,给出即时反馈;数据就绪后无缝替换为真实内容。
 * 结构对齐 page.tsx:页头 + 4 列指标卡 + 两栏明细块。
 */
export default function GlobalStatusLoading() {
  return (
    <div className="container mx-auto animate-pulse space-y-8 px-4 py-6 motion-reduce:animate-none md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-muted" />
          <div className="h-4 w-80 max-w-full rounded bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-20 rounded bg-muted" />
          <div className="h-8 w-44 rounded bg-muted" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={`metric-${i}`}
            className="space-y-3 rounded-lg border p-5"
          >
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-8 w-20 rounded bg-muted" />
            <div className="h-3 w-32 rounded bg-muted" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={`panel-${i}`} className="space-y-4 rounded-lg border p-6">
            <div className="h-5 w-32 rounded bg-muted" />
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={`row-${i}-${j}`} className="h-4 w-full rounded bg-muted" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
