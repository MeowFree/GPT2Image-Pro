import type { ComponentPropsWithoutRef } from "react";

/**
 * 自带 Tailwind 样式的 MDX 渲染组件集。
 *
 * 用途：在「未加载 fumadocs/.prose 样式」的位置(如 dashboard)内联渲染 MDX 文档体，
 * 见 `backend-docs.tsx`。本站没装 `@tailwindcss/typography`，且 fumadocs 的全局 CSS
 * 进 dashboard 会用 @layer 覆盖 `md:flex` 搞乱布局(历史事故)，故这里用语义化 token
 * (text-foreground / bg-muted / border ...)自行排版——既深浅色自适应，又零外部 CSS 依赖。
 *
 * 关键：所有标题透传 `{...props}`，保留 rehype 在编译期注入的 `id`(锚点)，使
 * `#异步流程推荐` 一类深链与右侧 TOC 仍可用。
 */
export const docsMdxComponents = {
  h1: (props: ComponentPropsWithoutRef<"h1">) => (
    <h1
      {...props}
      className="mt-2 scroll-mt-24 font-serif text-2xl font-semibold tracking-tight"
    />
  ),
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h2
      {...props}
      className="mt-10 scroll-mt-24 border-b pb-1 text-xl font-semibold tracking-tight"
    />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3
      {...props}
      className="mt-6 scroll-mt-24 text-lg font-medium tracking-tight"
    />
  ),
  h4: (props: ComponentPropsWithoutRef<"h4">) => (
    <h4 {...props} className="mt-4 scroll-mt-24 text-base font-medium" />
  ),
  p: (props: ComponentPropsWithoutRef<"p">) => (
    <p {...props} className="mt-3 text-sm leading-relaxed text-muted-foreground" />
  ),
  a: (props: ComponentPropsWithoutRef<"a">) => (
    <a
      {...props}
      className="font-medium text-primary underline underline-offset-2"
    />
  ),
  ul: (props: ComponentPropsWithoutRef<"ul">) => (
    <ul
      {...props}
      className="mt-3 list-disc space-y-1 pl-6 text-sm text-muted-foreground"
    />
  ),
  ol: (props: ComponentPropsWithoutRef<"ol">) => (
    <ol
      {...props}
      className="mt-3 list-decimal space-y-1 pl-6 text-sm text-muted-foreground"
    />
  ),
  li: (props: ComponentPropsWithoutRef<"li">) => (
    <li {...props} className="leading-relaxed" />
  ),
  strong: (props: ComponentPropsWithoutRef<"strong">) => (
    <strong {...props} className="font-semibold text-foreground" />
  ),
  code: (props: ComponentPropsWithoutRef<"code">) => (
    <code
      {...props}
      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
    />
  ),
  pre: (props: ComponentPropsWithoutRef<"pre">) => (
    <pre
      {...props}
      className="mt-3 overflow-x-auto rounded-md border bg-muted/50 p-4 text-xs leading-relaxed [&_code]:bg-transparent [&_code]:px-0 [&_code]:py-0"
    />
  ),
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      {...props}
      className="mt-3 border-l-2 border-border pl-4 text-sm italic text-muted-foreground"
    />
  ),
  hr: (props: ComponentPropsWithoutRef<"hr">) => (
    <hr {...props} className="my-8 border-border" />
  ),
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="mt-3 overflow-x-auto rounded-md border">
      <table {...props} className="w-full border-collapse text-sm" />
    </div>
  ),
  thead: (props: ComponentPropsWithoutRef<"thead">) => (
    <thead {...props} className="bg-muted/60 text-left" />
  ),
  th: (props: ComponentPropsWithoutRef<"th">) => (
    <th {...props} className="border-b px-3 py-2 font-medium text-foreground" />
  ),
  td: (props: ComponentPropsWithoutRef<"td">) => (
    <td
      {...props}
      className="border-b px-3 py-2 align-top text-muted-foreground"
    />
  ),
};
