import { siteConfig } from "@repo/shared/config";
import { Separator } from "@repo/ui/components/separator";
import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { getBlogPosts } from "@/lib/source";

import { BlogPostCard } from "./blog-post-card";

/**
 * 生成博客列表页 Metadata
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh ? "博客文章" : "Blog Posts";
  const description = isZh
    ? "发现 GPT2IMAGE 团队的最新见解、教程和更新。了解产品最新动态。"
    : "Discover the latest insights, tutorials, and updates from the GPT2IMAGE team. Learn about the latest product news.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}/blog`,
      siteName: siteConfig.name,
    },
    alternates: {
      canonical: `${siteConfig.url}/${locale}/blog`,
      languages: {
        en: `${siteConfig.url}/en/blog`,
        zh: `${siteConfig.url}/zh/blog`,
      },
    },
  };
}

/**
 * 博客列表页面
 *
 * 显示当前语言的所有博客文章
 */
export default async function BlogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const posts = getBlogPosts(locale);

  // 按日期排序（最新的在前）
  const sortedPosts = posts.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateB.getTime() - dateA.getTime();
  });

  return (
    <div className="container mx-auto max-w-5xl py-20">
      {/* Breadcrumb JSON-LD */}
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: `/${locale}` },
          {
            name: locale === "zh" ? "博客" : "Blog",
            url: `/${locale}/blog`,
          },
        ]}
      />

      {/* Header - 衬线标题 + 编辑部式入场 */}
      <div className="mb-16 text-center animate-in fade-in slide-in-from-bottom-2 duration-400 motion-reduce:animate-none">
        <h1 className="font-serif text-4xl font-medium tracking-tight md:text-5xl">
          {locale === "zh" ? "博客文章" : "Blog Posts"}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {locale === "zh"
            ? "发现 GPT2IMAGE 团队的最新见解、教程和更新。了解产品最新动态。"
            : "Discover the latest insights, tutorials, and updates from the GPT2IMAGE team. Learn about the latest product news."}
        </p>
      </div>

      {/* Posts List */}
      {sortedPosts.length > 0 ? (
        <div className="space-y-12">
          {sortedPosts.map((post, index) => {
            // 从路径中提取 slug
            const pathParts = post.info.path.split("/");
            const fileName = pathParts[pathParts.length - 1] ?? "";
            const slug = fileName.replace(/\.mdx$/, "");

            return (
              // 列表项入场错峰:按索引 70ms 递增(封顶 6 档),fill-mode 用
              // backwards 保证延迟期间停留在动画首帧(透明),避免闪现跳变。
              <div
                key={post.info.path}
                className="animate-in fade-in slide-in-from-bottom-2 duration-400 motion-reduce:animate-none"
                style={{
                  animationDelay: `${Math.min(index, 6) * 70}ms`,
                  animationFillMode: "backwards",
                }}
              >
                <BlogPostCard
                  slug={slug}
                  title={post.title}
                  description={post.description}
                  date={
                    typeof post.date === "string"
                      ? post.date
                      : (post.date.toISOString().split("T")[0] ?? "")
                  }
                  author={post.author}
                  tags={post.tags}
                />
                {index < sortedPosts.length - 1 && (
                  <Separator className="mt-12" />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border py-24 text-center text-muted-foreground">
          {locale === "zh" ? "暂无博客文章" : "No blog posts yet"}
        </div>
      )}
    </div>
  );
}
