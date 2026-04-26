/**
 * Auth 路由组布局 (Admin)
 * 用于管理员登录页面
 * 简洁的居中布局
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 主内容区域 */}
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        {children}
      </main>

      {/* 简洁底部 */}
      <footer className="border-t py-4 text-center text-sm text-muted-foreground">
        <p>GPT2Image Admin Panel</p>
      </footer>
    </div>
  );
}
