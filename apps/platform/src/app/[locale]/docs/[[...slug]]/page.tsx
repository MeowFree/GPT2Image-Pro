import { DocsBody, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getSystemDocsMetadata,
  SystemDocsContent,
} from "@/features/docs/system-docs";
import { docsSource } from "@/lib/source";

function isSystemDocsSlug(slug?: string[]) {
  if (!slug?.length) {
    return true;
  }

  const path = slug.join("/");
  return path === "system" || path === "backend-help";
}

/**
 * 生成静态参数
 */
export function generateStaticParams() {
  return [...docsSource.generateParams(), { slug: ["system"] }];
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
