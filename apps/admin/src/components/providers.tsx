"use client";

import { ThemeProvider } from "next-themes";

/**
 * Admin 站 Providers 组件
 *
 * 功能:
 * - 主题管理 (next-themes)
 * - 不包含 fumadocs RootProvider（admin 站不需要文档功能）
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
