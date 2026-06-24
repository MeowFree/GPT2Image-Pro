import { docsSource } from "@/lib/source";

import { docsMdxComponents } from "./mdx-components";
import { SystemDocsContent } from "./system-docs";

/**
 * 「内部系统文档」= 系统架构与请求路由(SystemDocsContent)+ 外部 API 参考。
 *
 * 外部 API 参考来自 `content/docs/external-api.mdx`，在此内联渲染(用自带样式的
 * `docsMdxComponents`，不依赖 fumadocs/.prose CSS)，使同一份内容可同时安全出现在：
 * - 控制台 `/dashboard/backend-help`（未加载 fumadocs 样式）；
 * - 公开文档 `/docs/system`（与 Adobe 两页平级的侧栏页）。
 *
 * @param locale 语言（system 架构部分有 zh/en；外部 API 部分为单一 MDX）。
 * @param className 外层容器类名（dashboard 自带容器；/docs 由 DocsBody 提供布局）。
 */
export function BackendDocs({
  locale = "en",
  className = "container mx-auto max-w-7xl space-y-10 px-4 py-6 md:px-6",
}: {
  locale?: string;
  className?: string;
}) {
  const apiPage = docsSource.getPage(["external-api"]);
  const ApiBody = apiPage?.data.body;

  return (
    <div className={className}>
      <SystemDocsContent className="space-y-6" locale={locale} />
      {ApiBody ? (
        <section className="space-y-2">
          <h2 className="scroll-mt-24 border-b pb-1 font-serif text-2xl font-medium tracking-tight">
            外部 API（OpenAI 兼容）
          </h2>
          <ApiBody components={docsMdxComponents} />
        </section>
      ) : null}
    </div>
  );
}
