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
 * 用于在博客列表页面显示文章摘要。
 * 封面卡 hover 时整体轻抬升(位移 + 边框提亮 + shadow-whisper),
 * 内部首字标做缓慢放大,构成编辑部式的层次反馈。
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
          {/* 标签 - v2 小标签规范:11px 大写宽字距 */}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {tags.map((tag) => (
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
          <h2 className="font-serif text-2xl font-medium tracking-tight decoration-foreground/30 underline-offset-4 group-hover:underline md:text-3xl">
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

        {/* 图片占位符 - 单色编辑部风:文章首字的衬线大字标。
            外层负责抬升与阴影,内层负责首字缓放(700ms ease-out)。 */}
        <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-[border-color,box-shadow,transform] duration-250 group-hover:-translate-y-0.5 group-hover:border-foreground/30 group-hover:shadow-whisper md:w-[380px]">
          <div className="flex h-full items-center justify-center transition-transform duration-700 ease-out group-hover:scale-[1.06]">
            <span className="font-serif text-6xl font-medium text-foreground/15 transition-colors duration-150 group-hover:text-foreground/30">
              {title.charAt(0)}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
