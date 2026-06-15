import type { ReactNode } from "react";

// 平台站根布局（营销/文档/博客/API控制台）
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
