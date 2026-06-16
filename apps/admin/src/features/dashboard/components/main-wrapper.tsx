"use client";

import { Menu, PanelLeft, PanelLeftClose } from "lucide-react";
import { usePathname } from "next/navigation";

import { useSidebar } from "@/features/dashboard/context";
import { cn } from "@repo/ui/utils";

/**
 * 从路径名获取页面标题
 *
 * 管理后台不需要 /admin 前缀
 */
function getPageTitle(pathname: string): string {
  const path = pathname.replace(/^\/[a-z]{2}\//, "/");
  const titleMap: Record<string, string> = {
    "/dashboard": "Global Status",
    "/dashboard/users": "User Management",
    "/dashboard/announcements": "Announcement Management",
    "/dashboard/settings": "System Settings",
  };

  return titleMap[path] || "Dashboard";
}

/**
 * 管理后台主内容区域包装器
 *
 * 根据侧边栏折叠状态动态调整左边距。
 * 与 apps/web 的区别：简化的页面标题映射，无翻译（管理后台暂用英文标题）。
 */
export function AdminMainWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isCollapsed, toggleSidebar, toggleMobile } = useSidebar();
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

  return (
    <main
      className={cn(
        "p-2.5 min-h-screen transition-all duration-300",
        isCollapsed ? "md:ml-16" : "md:ml-64"
      )}
    >
      {/* 卡片容器 */}
      <div className="min-h-[calc(100vh-20px)] rounded-lg bg-background border border-border flex flex-col">
        {/* Header */}
        <header className="flex h-12 items-center gap-3 border-b border-border px-4 shrink-0">
          {/* 移动端汉堡按钮 */}
          <button
            type="button"
            onClick={toggleMobile}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer md:hidden"
          >
            <Menu className="h-4 w-4 pointer-events-none" />
          </button>

          {/* 桌面端侧边栏折叠按钮 */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer md:flex"
          >
            {isCollapsed ? (
              <PanelLeft className="h-4 w-4 pointer-events-none" />
            ) : (
              <PanelLeftClose className="h-4 w-4 pointer-events-none" />
            )}
          </button>

          {/* 分割线 */}
          <div className="h-4 w-px bg-border" />

          {/* 页面标题 */}
          <span className="text-sm font-medium text-foreground">
            {pageTitle}
          </span>
        </header>

        {/* 内容区域 */}
        <div className="min-w-0 flex-1 overflow-x-auto p-6">{children}</div>
      </div>
    </main>
  );
}
