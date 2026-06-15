import type { ReactNode } from "react";

// 纯 API 应用，无用户界面
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
