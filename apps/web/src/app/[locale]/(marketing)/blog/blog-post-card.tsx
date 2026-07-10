import { Link } from "@/i18n/routing";

/**
 * 博客文章卡片属性
 */
interface BlogPostCardProps {
  slug: string;
  title: string;
  description?: string | undefined;
  date: string;
  author?: string | undefined;
  tags?: string[] | undefined;
}

/**
 * 博客文章卡片组件
 *
 * 用于在博客列表页面显示文章摘要
 */
export function BlogPostCard({
  slug,
  title,
  description,
  date,
  author,
  tags,
}: BlogPostCardProps) {
  return (
    <article className="group">
      <Link
        href={`/blog/${slug}`}
        className="flex flex-col gap-8 md:flex-row md:items-start"
      >
        {/* 文本内容 */}
        <div className="flex-1 space-y-4">
          {/* 标签 */}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 标题 */}
          <h2 className="font-serif text-2xl font-medium tracking-tight underline-offset-4 group-hover:underline md:text-3xl">
            {title}
          </h2>

          {/* 描述 */}
          {description && (
            <p className="leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}

          {/* 元数据 */}
          <p className="text-sm text-muted-foreground">
            {author && `${author} • `}
            {date}
          </p>
        </div>

        {/* 图片占位符 - 单色编辑部风:文章首字的衬线大字标 */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-colors duration-150 group-hover:bg-accent md:w-[380px]">
          <div className="flex h-full items-center justify-center">
            <span className="font-serif text-6xl font-medium text-foreground/15 transition-colors duration-150 group-hover:text-foreground/30">
              {title.charAt(0)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
