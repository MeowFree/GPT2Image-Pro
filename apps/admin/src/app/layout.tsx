import type { ReactNode } from "react";

import "@repo/ui/globals.css";

/**
 * 管理后台根布局
 *
 * 职责：提供 HTML 骨架与全局样式引入。
 * 所有 Provider（主题、国际化等）由 [locale]/layout.tsx 提供。
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
