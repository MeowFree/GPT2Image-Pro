import { DocsBody, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  getSystemDocsMetadata,
  SystemDocsContent,
} from "@/features/docs/system-docs";
import { docsSource } from "@/lib/source";

function isSystemDocsSlug(slug?: string[]) {
  // 根路径 /docs 改为渲染 index.mdx 的「文档目录」落地页(便于发现各文档)；
  // 系统架构总览仍保留在 /docs/system 与 /docs/backend-help。
  if (!slug?.length) {
    return false;
  }

  const path = slug.join("/");
  return path === "system" || path === "backend-help";
}

/**
 * 生成静态参数
 */
export function generateStaticParams() {
  // system 由 content/docs/system.mdx 自身的 generateParams 覆盖;此处仅补
  // backend-help(无对应 mdx 文件,但 isSystemDocsSlug 会渲染同一份 SystemDocsContent)。
  return [...docsSource.generateParams(), { slug: ["backend-help"] }];
}

/**
 * 生成页面元数据
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale?: string; slug?: string[] }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;

  if (isSystemDocsSlug(slug)) {
    return getSystemDocsMetadata(locale);
  }

  const page = docsSource.getPage(slug);

  if (!page) {
    return {
      title: "Not Found",
    };
  }

  return {
    title: page.data.title,
    description: page.data.description,
  };
}

/**
 * 文档页面
 *
 * 使用 Fumadocs UI 的 DocsPage 组件
 * 渲染 MDX 内容
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale?: string; slug?: string[] }>;
}) {
  const { locale, slug } = await params;

  // 外部 API 文档已并入「系统文档」(SystemDocsContent,数据驱动,渲染于 /docs/system 与
  // 控制台 backend-help);external-api.mdx 已删除。旧 /docs/external-api 链接重定向到 /docs/system。
  if (slug?.join("/") === "external-api") {
    redirect(`/${locale ?? "en"}/docs/system`);
  }

  if (isSystemDocsSlug(slug)) {
    return (
      <DocsPage
        breadcrumb={{ enabled: false }}
        className="max-w-[1600px] xl:max-w-[1600px]"
        footer={{ enabled: false }}
        full
        toc={[]}
      >
        <DocsBody className="max-w-none">
          <SystemDocsContent
            className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 lg:px-8"
            locale={locale}
          />
        </DocsBody>
      </DocsPage>
    );
  }

  const page = docsSource.getPage(slug);

  if (!page) {
    notFound();
  }

  const MDXContent = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsBody>
        <MDXContent />
      </DocsBody>
    </DocsPage>
  );
}
