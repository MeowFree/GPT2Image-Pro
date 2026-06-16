import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getAdminServerSession } from "@repo/shared/auth/admin-server";
import { AdminSidebar } from "@/features/dashboard/components/sidebar";
import { AdminMainWrapper } from "@/features/dashboard/components/main-wrapper";
import { SidebarProvider } from "@/features/dashboard/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 管理后台 Dashboard 布局
 *
 * 职责：
 * - 验证管理员会话（未认证则跳转登录页）
 * - 提供侧边栏 + 主内容区域的整体布局
 *
 * 与 apps/web 的 dashboard 布局的区别：
 * - 使用独立的 adminAuth 会话验证（admin_session 表）
 * - 无 CreateRuntimeProvider（管理后台不涉及图像生成创建流程）
 * - 使用精简的管理后台侧边栏
 */
export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminServerSession();
  const locale = await getLocale();

  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-muted">
        <AdminSidebar />
        <AdminMainWrapper>{children}</AdminMainWrapper>
      </div>
    </SidebarProvider>
  );
}
