import Link from "next/link";
import type { BlogPost } from "../data/mock-posts";

interface BlogPostItemProps {
  post: BlogPost;
}

export function BlogPostItem({ post }: BlogPostItemProps) {
  return (
    <article className="group">
      <Link
        href={`/blog/${post.slug}`}
        className="flex flex-col gap-8 md:flex-row md:items-start"
      >
        {/* Text Content */}
        <div className="flex-1 space-y-4">
          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Title */}
          <h2 className="font-serif text-2xl font-medium tracking-tight underline-offset-4 group-hover:underline md:text-3xl">
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

        {/* 图片占位符 - 单色编辑部风:文章首字的衬线大字标 */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-colors duration-150 group-hover:bg-accent md:w-[380px]">
          <div className="flex h-full items-center justify-center">
            <span className="font-serif text-6xl font-medium text-foreground/15 transition-colors duration-150 group-hover:text-foreground/30">
              {post.title.charAt(0)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
