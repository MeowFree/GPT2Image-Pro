// 注意:不要在本布局引入 fumadocs-ui/style.css。它自带一套 @layer utilities(含
// .hidden{display:none}),作为第二个样式表加载时会按层叠顺序压过本 app 的 .md:flex/
// .md:inline-flex,导致整个营销组(含首页)Header 的 `hidden md:flex` 导航与按钮在所有
// 宽度被永久 display:none。fumadocs CSS 只有 legal/[slug] 的 .prose 需要,
// 故下沉到该页面引入,避免污染首页等无关页面。
import { getServerSession } from "@repo/shared/auth/server";
import { Footer, Header } from "@/features/marketing/components";
import {
  CurrentSessionProvider,
  type CurrentSession,
} from "@/features/auth/hooks/use-current-session";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const initialSession: CurrentSession = session?.user?.id
    ? {
        user: {
          id: session.user.id,
          name: session.user.name || "",
          email: session.user.email || "",
          image: session.user.image,
        },
      }
    : null;

  return (
    <CurrentSessionProvider initialData={initialSession}>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </CurrentSessionProvider>
  );
}
