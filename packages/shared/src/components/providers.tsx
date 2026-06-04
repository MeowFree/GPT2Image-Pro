"use client";

import { ThemeProvider } from "next-themes";

/**
 * 全局 Providers 组件
 *
 * 功能:
 * - 主题管理 (next-themes)
 * - 可扩展添加其他 Provider (如 QueryClient, SessionProvider 等)
 *
 * 注意:fumadocs 的 RootProvider 不在此全局挂载(否则会把 fumadocs 的 provider 树 +
 * 全局 Cmd/Ctrl+K 监听加到每个 dashboard/marketing/auth 页);仅在 docs 布局内单独挂载。
 */

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
