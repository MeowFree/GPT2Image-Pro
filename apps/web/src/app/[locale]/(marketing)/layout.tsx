// fumadocs-ui/style.css 此前在 root layout 全局引入、污染所有 authed 页(每页 +78KB CSS);
// 现仅在用到它的地方引入。营销组的 blog/[slug]、legal/[slug] 用 .prose 排版正文,其样式
// 由这块 CSS 提供(未装 @tailwindcss/typography),故在营销布局引入以覆盖这两页。
import "fumadocs-ui/style.css";
import { Footer, Header } from "@/features/marketing/components";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
