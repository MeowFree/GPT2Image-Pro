"use client";

import {
  Activity,
  LogOut,
  Megaphone,
  PanelLeft,
  PanelLeftClose,
  Settings,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";

import { Sheet, SheetContent, SheetTitle } from "@repo/ui/components/sheet";
import { cn } from "@repo/ui/utils";
import { ModeToggle } from "@repo/shared/components";
import { useSidebar } from "@/features/dashboard/context";

/**
 * 管理后台侧边栏导航项配置
 *
 * 管理后台不需要 /admin 前缀（整个应用就是管理后台）
 */
const adminNavItems = [
  {
    title: "Global Status",
    href: "/dashboard",
    icon: Activity,
  },
  {
    title: "User Management",
    href: "/dashboard/users",
    icon: Users,
  },
  {
    title: "Announcements",
    href: "/dashboard/announcements",
    icon: Megaphone,
  },
  {
    title: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
  },
];

/**
 * 管理后台侧边栏组件
 *
 * 精简版侧边栏，仅包含管理功能导航。
 * 与 apps/web 的侧边栏不同：
 * - 无用户信息弹出菜单（管理员信息从独立会话获取）
 * - 无计划/积分展示
 * - 固定的管理功能导航项
 */
export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale();
  const { isCollapsed, isMobileOpen, setMobileOpen, toggleSidebar } =
    useSidebar();

  const localizedHref = (href: string) =>
    href.startsWith("/") ? `/${locale}${href}` : href;

  /**
   * 处理登出
   *
   * 管理员登出清除 admin session cookie，跳转到登录页
   */
  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } catch {
      // 忽略网络错误，仍然跳转
    }
    router.push(`/${locale}/sign-in`);
  };

  /**
   * 渲染侧边栏内容（桌面和移动端共用）
   */
  const renderSidebarContent = (mobile: boolean) => {
    const collapsed = mobile ? false : isCollapsed;

    return (
      <>
        {/* Logo */}
        <div className="flex h-14 items-center px-4">
          <Link
            href={`/${locale}/dashboard`}
            prefetch={false}
            className="flex items-center gap-2"
            onClick={(e) => {
              if (mobile) {
                setMobileOpen(false);
              } else if (collapsed) {
                e.preventDefault();
                toggleSidebar();
              }
            }}
          >
            <Image
              src="/assets/icon.png"
              alt="GPT2IMAGE Admin"
              width={24}
              height={24}
              className="shrink-0"
            />
            <span
              className={cn(
                "font-serif text-lg font-medium tracking-tight transition-opacity",
                collapsed && "opacity-0"
              )}
            >
              Admin
            </span>
          </Link>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {adminNavItems.map((item) => {
            const normalizedPath = pathname.replace(/^\/[a-z]{2}\//, "/");
            const isActive =
              normalizedPath === item.href ||
              (item.href !== "/dashboard" &&
                normalizedPath.startsWith(`${item.href}/`));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={localizedHref(item.href)}
                prefetch={false}
                title={collapsed ? item.title : undefined}
                onClick={() => mobile && setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                  collapsed && "justify-center px-0"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="flex-1">{item.title}</span>}
              </Link>
            );
          })}
        </nav>

        {/* 底部操作区 */}
        <div className="border-t border-sidebar-border p-3 space-y-2">
          {/* 主题切换 */}
          <div className="flex items-center justify-center">
            <ModeToggle variant="inline" />
          </div>

          {/* 登出 */}
          <button
            type="button"
            onClick={handleSignOut}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors",
              collapsed && "justify-center px-0"
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </>
    );
  };

  return (
    <>
      {/* 桌面端侧边栏 */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-screen flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 md:flex",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* 移动端 Sheet 侧边栏 */}
      <Sheet open={isMobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-64 bg-sidebar p-0 md:hidden [&>button:last-child]:hidden"
        >
          <SheetTitle className="sr-only">Admin Navigation</SheetTitle>
          <div className="flex h-full flex-col">
            {renderSidebarContent(true)}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
