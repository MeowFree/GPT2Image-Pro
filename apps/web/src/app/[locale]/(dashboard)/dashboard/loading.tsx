/**
 * Dashboard 页面加载骨架屏
 *
 * Next.js App Router 会在页面数据获取时自动显示此组件
 * 提供即时视觉反馈，避免页面切换时的"卡顿"感
 * 结构与首页实际布局对齐（标题 + 三张统计卡 + 计价图表 + 最近创作），
 * 减少骨架到真实内容切换时的布局跳动
 */
export default function DashboardLoading() {
  return (
    <div className="container mx-auto animate-pulse px-4 py-6 md:px-6 motion-reduce:animate-none">
      <div className="space-y-8">
        {/* 页面标题骨架:眉题 + 大号衬线标题 + 副行 */}
        <div className="space-y-2">
          <div className="h-3 w-14 rounded-md bg-muted" />
          <div className="h-9 w-44 rounded-md bg-muted" />
          <div className="h-4 w-56 rounded-md bg-muted" />
        </div>

        {/* 统计卡片行骨架 */}
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              // 骨架为静态占位,索引即稳定标识
              // biome-ignore lint/suspicious/noArrayIndexKey: 静态骨架无重排
              key={i}
              className="space-y-4 rounded-lg border border-border p-6"
            >
              <div className="flex items-center justify-between">
                <div className="h-3 w-24 rounded-md bg-muted" />
                <div className="h-4 w-4 rounded-full bg-muted" />
              </div>
              <div className="space-y-2">
                <div className="h-9 w-24 rounded-md bg-muted" />
                <div className="h-3 w-3/4 rounded-md bg-muted" />
              </div>
            </div>
          ))}
        </div>

        {/* 计价图表卡骨架 */}
        <div className="space-y-4 rounded-lg border border-border p-6">
          <div className="h-5 w-40 rounded-md bg-muted" />
          <div className="h-[240px] w-full rounded-md bg-muted" />
        </div>

        {/* 最近创作区骨架 */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="h-6 w-32 rounded-md bg-muted" />
            <div className="h-8 w-20 rounded-md bg-muted" />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: 静态骨架无重排
                key={i}
                className="aspect-square rounded-lg bg-muted"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
