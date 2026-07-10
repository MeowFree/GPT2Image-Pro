// fumadocs CSS 仅文章正文的 .prose 排版需要,就近在本页引入(不要放进营销布局,
// 否则它会污染首页等所有营销页、压垮 Header 响应式导航)。
import "fumadocs-ui/style.css";
import { siteConfig } from "@repo/shared/config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleJsonLd, BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { Link } from "@/i18n/routing";
import { getAllBlogSlugs, getBlogPost } from "@/lib/source";

/**
 * 生成静态参数
 */
export function generateStaticParams() {
  return getAllBlogSlugs();
}

/**
 * 生成页面元数据 (enhanced with article metadata)
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = getBlogPost(slug, locale);

  if (!post) {
    return {
      title: "Post Not Found",
    };
  }

  const publishedDate =
    typeof post.date === "string" ? post.date : post.date.toISOString();

  const url = `${siteConfig.url}/${locale}/blog/${slug}`;

  return {
    title: post.title,
    description: post.description,
    authors: post.author ? [{ name: post.author }] : undefined,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      url,
      siteName: siteConfig.name,
      publishedTime: publishedDate,
      authors: post.author ? [post.author] : undefined,
      tags: post.tags,
      images: [
        {
          url: `${siteConfig.url}${siteConfig.ogImage}`,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
    alternates: {
      canonical: url,
      languages: {
        en: `${siteConfig.url}/en/blog/${slug}`,
        zh: `${siteConfig.url}/zh/blog/${slug}`,
      },
    },
  };
}

/**
 * 博客文章详情页面
 */
export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const post = getBlogPost(slug, locale);

  if (!post) {
    notFound();
  }

  // 获取 MDX 内容组件
  const MDXContent = post.body;

  // 格式化日期
  const formattedDate =
    typeof post.date === "string"
      ? post.date
      : post.date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

  const isoDate =
    typeof post.date === "string" ? post.date : post.date.toISOString();

  return (
    <article className="container mx-auto max-w-3xl py-20">
      {/* JSON-LD Structured Data */}
      <ArticleJsonLd
        title={post.title}
        description={post.description || ""}
        slug={slug}
        locale={locale as "en" | "zh"}
        publishedAt={isoDate}
        {...(post.author && { author: post.author })}
        {...(post.tags && { tags: post.tags })}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `/${locale}` },
          {
            name: locale === "zh" ? "博客" : "Blog",
            url: `/${locale}/blog`,
          },
          { name: post.title, url: `/${locale}/blog/${slug}` },
        ]}
      />

      {/* 返回链接 */}
      <Link
        href="/blog"
        className="mb-8 inline-flex items-center text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        ← {locale === "zh" ? "返回博客" : "Back to Blog"}
      </Link>

      {/* 文章头部 - 底部细分隔线收束,与正文形成呼吸 */}
      <header className="mb-10 border-b border-border/60 pb-8 animate-in fade-in slide-in-from-bottom-2 duration-400 motion-reduce:animate-none">
        {/* 标签 - v2 小标签规范:11px 大写宽字距 */}
        {post.tags && post.tags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-x-3 gap-y-1">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* 标题 */}
        <h1 className="mb-4 font-serif text-4xl font-medium leading-[1.15] tracking-tight md:text-5xl">
          {post.title}
        </h1>

        {/* 描述 */}
        {post.description && (
          <p className="mb-6 text-xl leading-relaxed text-muted-foreground">
            {post.description}
          </p>
        )}

        {/* 元数据 - dateTime 用 ISO 值保证机器可读,展示仍用本地化格式 */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {post.author && <span>{post.author}</span>}
          <span>•</span>
          <time dateTime={isoDate}>{formattedDate}</time>
        </div>
      </header>

      {/* 文章内容 - fumadocs 只提供基础 .prose(项目未装 typography 插件,
          prose-headings: 等修饰变体不会生效),故用 Tailwind 原生 [&_x]: 任意
          变体做 token 化排版精修:标题衬线 font-medium、正文行距放宽、链接
          下划线用 border 色、引用块细左线 + muted 前景、代码块描边圆角。
          正文首个 h1 与上方页头标题重复,视觉上隐藏但保留给读屏与 SEO。 */}
      <div
        className="prose max-w-none animate-in fade-in slide-in-from-bottom-2 duration-400 motion-reduce:animate-none [&>h1:first-child]:sr-only [&_h1]:font-serif [&_h1]:font-medium [&_h1]:tracking-tight [&_h2]:font-serif [&_h2]:font-medium [&_h2]:tracking-tight [&_h3]:font-serif [&_h3]:font-medium [&_h3]:tracking-tight [&_h4]:font-serif [&_h4]:font-medium [&_p]:leading-[1.85] [&_li]:leading-[1.85] [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_a]:transition-colors [&_a]:duration-150 [&_a:hover]:decoration-foreground [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-5 [&_blockquote]:font-serif [&_blockquote]:font-normal [&_blockquote]:text-muted-foreground [&_blockquote_p:first-of-type]:before:content-none [&_blockquote_p:last-of-type]:after:content-none [&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:p-4 [&_pre]:text-sm [&_pre]:leading-relaxed [&_hr]:border-border/60"
        style={{ animationDelay: "100ms", animationFillMode: "backwards" }}
      >
        <MDXContent />
      </div>
    </article>
  );
}
