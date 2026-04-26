"use client";

import {
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Ticket,
  Users,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { Separator } from "@repo/ui/components/separator";
import { siteConfig } from "@repo/shared/config";
import { signOut, useSession } from "@repo/shared/auth/client";
import { cn } from "@repo/ui/utils";

/**
 * 主题类型
 */
type Theme = "light" | "dark" | "system";

/**
 * Admin 侧边栏导航配置（本地覆盖，使用 /dashboard 路径）
 */
const adminSidebarNav = [
  {
    title: "Admin",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "Users",
        href: "/dashboard/users",
        icon: Users,
      },
      {
        title: "Tickets",
        href: "/dashboard/tickets",
        icon: Ticket,
      },
    ],
  },
];

/**
 * Admin 侧边栏组件 (管理站专用)
 *
 * 功能:
 * - Admin 专用导航菜单（路径使用 /dashboard 前缀）
 * - 用户信息弹出菜单
 * - 主题切换
 * - 登出功能
 *
 * 与原版差异:
 * - 所有 href 从 /admin 改为 /dashboard
 * - 删除 "Back to Dashboard" 链接（管理站没有用户端可返回）
 */
export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  // 获取当前用户会话
  const { data: session } = useSession();
  const user = session?.user;

  // 主题状态 (简化版，实际应使用 next-themes)
  const [theme, setTheme] = useState<Theme>("system");

  // Popover 开关状态
  const [open, setOpen] = useState(false);

  /**
   * 获取用户名首字母作为头像回退
   */
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  /**
   * 处理登出
   */
  const handleSignOut = async () => {
    setOpen(false);
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/sign-in");
        },
      },
    });
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-background text-foreground">
      {/* Logo - Admin 标识 */}
      <div className="flex h-14 items-center border-b px-4">
        <a
          href="/dashboard"
          className="flex items-center gap-2 text-lg font-serif font-bold tracking-tight"
        >
          <img src="/assets/icon.png" alt="Logo" className="h-6 w-6 shrink-0" />
          <span className="rounded bg-foreground px-2 py-0.5 text-xs font-medium text-background">
            Admin
          </span>
          {siteConfig.name}
        </a>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 space-y-6 overflow-y-auto p-4">
        {adminSidebarNav.map((group) => (
          <div key={group.title}>
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4" />}
                    {item.title}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 用户信息区域 */}
      <div className="border-t p-4">
        {user ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 hover:bg-accent transition-colors"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.image || undefined} alt={user.name} />
                  <AvatarFallback className="bg-foreground text-background text-xs">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 truncate text-left">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {user.name}
                    </p>
                    <span className="rounded bg-foreground px-1.5 py-0.5 text-xs font-medium text-background">
                      Admin
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.email}
                  </p>
                </div>
                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </PopoverTrigger>

            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-64 p-0"
            >
              {/* 用户信息头部 */}
              <div className="flex items-center gap-3 p-4">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={user.image || undefined} alt={user.name} />
                  <AvatarFallback className="bg-foreground text-background">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 truncate">
                  <p className="font-medium">{user.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {user.email}
                  </p>
                </div>
              </div>

              <Separator />

              {/* 主题切换 */}
              <div className="flex items-center justify-center gap-1 p-3">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    theme === "light"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title="Light"
                >
                  <Sun className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    theme === "dark"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title="Dark"
                >
                  <Moon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
                    theme === "system"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title="System"
                >
                  <Monitor className="h-4 w-4" />
                </button>
              </div>

              <Separator />

              {/* 菜单项 */}
              <div className="p-2">
                {/* 登出 */}
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          // 加载状态
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
