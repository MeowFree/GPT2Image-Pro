import Link from "next/link";
import type { BlogPost } from "../data/mock-posts";

interface BlogPostItemProps {
  post: BlogPost;
}

/**
 * 博客文章列表项(mock 数据版,与页面级 blog-post-card 保持同一视觉语言)
 *
 * 封面卡 hover 时轻抬升 + 边框提亮 + shadow-whisper,首字标缓慢放大。
 */
export function BlogPostItem({ post }: BlogPostItemProps) {
  return (
    <article className="group">
      <Link
        href={`/blog/${post.slug}`}
        className="flex flex-col gap-8 md:flex-row md:items-start"
      >
        {/* Text Content */}
        <div className="flex-1 space-y-4">
          {/* Tags - v2 小标签规范:11px 大写宽字距 */}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Title */}
          <h2 className="font-serif text-2xl font-medium tracking-tight decoration-foreground/30 underline-offset-4 group-hover:underline md:text-3xl">
            {post.title}
          </h2>

          {/* Excerpt */}
          <p className="leading-relaxed text-muted-foreground">
            {post.excerpt}
          </p>

          {/* Metadata */}
          <p className="text-sm text-muted-foreground">
            {post.author} • {post.date}
          </p>
        </div>

        {/* 图片占位符 - 单色编辑部风:文章首字的衬线大字标。
            外层负责抬升与阴影,内层负责首字缓放(700ms ease-out)。 */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-[border-color,box-shadow,transform] duration-250 group-hover:-translate-y-0.5 group-hover:border-foreground/30 group-hover:shadow-whisper md:w-[380px]">
          <div className="flex h-full items-center justify-center transition-transform duration-700 ease-out group-hover:scale-[1.06]">
            <span className="font-serif text-6xl font-medium text-foreground/15 transition-colors duration-150 group-hover:text-foreground/30">
              {post.title.charAt(0)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
