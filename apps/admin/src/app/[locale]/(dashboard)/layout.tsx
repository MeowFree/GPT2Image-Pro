import { checkAdmin } from "@repo/shared/auth/admin";

import { AdminSidebar } from "@/features/admin/components/admin-sidebar";

/**
 * Dashboard 布局组件 (Admin 站)
 *
 * 功能:
 * - RBAC 权限检查 (只有 admin 角色可访问)
 * - Admin 专用侧边栏
 * - 路径为 /dashboard 而非 /admin（独立站点）
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 权限检查 - 非管理员会被重定向
  await checkAdmin();

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />
      <div className="pl-64">
        {/* Admin 顶栏 */}
        <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-background/80 px-6 backdrop-blur">
          <h1 className="text-lg font-serif font-semibold">Admin Panel</h1>
        </header>
        {/* 主内容区域 */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
