import { AuthFooter } from "@/features/auth/components/auth-footer";

/**
 * Auth 路由组布局
 * 用于登录、注册等认证页面
 * 包含简洁的头部和底部
 * 表单统一包裹在书卷气卡片中，整页淡入上移入场
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
        {/* 卡片容器:各认证表单共用,暗色下与页面底色分层,亮色下靠描边区分 */}
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-whisper animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none sm:p-8">
          {children}
        </div>
      </main>

      {/* 底部版权和法律链接 */}
      <AuthFooter />
    </div>
  );
}
