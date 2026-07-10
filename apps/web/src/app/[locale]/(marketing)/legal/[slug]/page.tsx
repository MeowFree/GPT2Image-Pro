// fumadocs CSS 仅法律文档正文的 .prose 排版需要,就近在本页引入(不要放进营销布局,
// 否则它会污染首页等所有营销页、压垮 Header 响应式导航)。
import "fumadocs-ui/style.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/routing";
import { getAllLegalSlugs, getLegalDoc } from "@/lib/source";

/**
 * 生成静态参数
 * 用于预渲染所有法律文档页面
 */
export function generateStaticParams() {
  return getAllLegalSlugs();
}

/**
 * 生成页面元数据
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const doc = getLegalDoc(slug, locale);

  if (!doc) {
    return {
      title: "Document Not Found",
    };
  }

  return {
    title: doc.title,
    description: doc.description,
  };
}

/**
 * 法律文档详情页面
 *
 * 路由: /legal/[slug]
 * 支持: /legal/terms, /legal/privacy, /legal/cookie-policy
 */
export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const doc = getLegalDoc(slug, locale);

  // 文档不存在时返回 404
  if (!doc) {
    notFound();
  }

  // 获取 MDX 内容组件
  const MDXContent = doc.body;

  // 格式化日期
  const formattedDate =
    typeof doc.date === "string"
      ? doc.date
      : doc.date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

  return (
    <article className="container mx-auto max-w-3xl py-20">
      {/* 返回链接 */}
      <Link
        href="/"
        className="mb-8 inline-flex items-center text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        ← {locale === "zh" ? "返回首页" : "Back to Home"}
      </Link>

      {/* 文档头部 */}
      <header className="mb-10 border-b border-border/60 pb-8 animate-in fade-in slide-in-from-bottom-2 duration-400 motion-reduce:animate-none">
        {/* 标题 */}
        <h1 className="mb-4 font-serif text-3xl font-medium tracking-tight md:text-4xl">
          {doc.title}
        </h1>

        {/* 最后更新日期 - v2 小标签规范;dateTime 用原始日期值保证机器可读 */}
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {locale === "zh" ? "最后更新：" : "Last Updated: "}
          <time
            dateTime={
              typeof doc.date === "string" ? doc.date : doc.date.toISOString()
            }
          >
            {formattedDate}
          </time>
        </p>
      </header>

      {/* 文档内容 - fumadocs 只提供基础 .prose(项目未装 typography 插件,
          prose-h2: 等修饰变体不会生效),故用 [&_x]: 任意变体做 token 化精修:
          标题衬线 font-medium 并收紧字号层级、链接悬停划线、表格描边。
          正文首个 h1 与上方页头标题重复,视觉上隐藏但保留给读屏与 SEO。 */}
      <div
        className="prose max-w-none animate-in fade-in slide-in-from-bottom-2 duration-400 motion-reduce:animate-none [&>h1:first-child]:sr-only [&_h1]:font-serif [&_h1]:font-medium [&_h1]:tracking-tight [&_h2]:font-serif [&_h2]:font-medium [&_h2]:tracking-tight [&_h2]:text-xl [&_h3]:font-serif [&_h3]:font-medium [&_h3]:text-lg [&_p]:leading-[1.85] [&_li]:leading-[1.85] [&_a]:font-medium [&_a]:text-foreground [&_a]:no-underline [&_a]:underline-offset-4 [&_a]:transition-colors [&_a]:duration-150 [&_a:hover]:underline [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-5 [&_blockquote]:font-serif [&_blockquote]:font-normal [&_blockquote]:text-muted-foreground [&_table]:text-sm [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:border-border [&_td]:p-2 [&_hr]:border-border/60"
        style={{ animationDelay: "100ms", animationFillMode: "backwards" }}
      >
        <MDXContent />
      </div>

      {/* 底部导航 - 静默灰起步,悬停回到前景色,交互色过渡 150ms */}
      <footer className="mt-12 border-t border-border/60 pt-8">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {locale === "zh" ? "其他法律文档：" : "Other Legal Documents:"}
          </span>
          {slug !== "terms" && (
            <Link
              href="/legal/terms"
              className="text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
            >
              {locale === "zh" ? "服务条款" : "Terms of Service"}
            </Link>
          )}
          {slug !== "privacy" && (
            <Link
              href="/legal/privacy"
              className="text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
            >
              {locale === "zh" ? "隐私政策" : "Privacy Policy"}
            </Link>
          )}
          {slug !== "cookie-policy" && (
            <Link
              href="/legal/cookie-policy"
              className="text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline"
            >
              {locale === "zh" ? "Cookie 政策" : "Cookie Policy"}
            </Link>
          )}
        </div>
      </footer>
    </article>
  );
}
