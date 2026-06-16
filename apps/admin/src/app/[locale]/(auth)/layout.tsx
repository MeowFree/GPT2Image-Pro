/**
 * 管理后台认证页面布局
 *
 * 为登录等认证页面提供居中布局。
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {children}
    </div>
  );
}
