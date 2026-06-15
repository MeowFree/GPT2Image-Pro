import { Github, Twitter } from "lucide-react";
import Link from "next/link";
import { getLocale } from "next-intl/server";

import { footerNav, siteConfig } from "@repo/shared/config";

const footerTitleMap = {
  product: {
    Pricing: "定价",
    Docs: "文档",
    "Contact Us": "联系我们",
  },
  legal: {
    "Terms of Service": "服务条款",
    "Privacy Policy": "隐私政策",
    "Cookie Policy": "Cookie 政策",
  },
} as const;

function getFooterLinkTitle(
  title: string,
  group: keyof typeof footerTitleMap,
  isZh: boolean
) {
  if (!isZh) return title;
  return footerTitleMap[group][
    title as keyof (typeof footerTitleMap)[typeof group]
  ] || title;
}

/**
 * Marketing 页面底部
 *
 * 功能:
 * - 品牌信息 + 产品描述
 * - 产品、法律链接
 * - 社交媒体链接
 * - 版权信息
 */
export async function Footer() {
  const isZh = (await getLocale()) === "zh";

  return (
    <footer className="border-t bg-background">
      <div className="container py-16">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          {/* 品牌区 */}
          <div>
            <Link href="/" className="mb-4 inline-block">
              <span className="font-serif text-xl font-medium">GPT2IMAGE</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              {isZh
                ? "AI 驱动的对话生图平台。"
                : "AI-powered chat-to-image generation platform."}
            </p>
          </div>

          {/* 链接区 */}
          <div className="grid grid-cols-2 gap-8">
            {/* 产品 */}
            <div>
              <h3 className="mb-4 text-sm font-semibold">
                {isZh ? "产品" : "Product"}
              </h3>
              <ul className="space-y-3">
                {footerNav.product.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      {...(link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {getFooterLinkTitle(link.title, "product", isZh)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* 法律 */}
            <div>
              <h3 className="mb-4 text-sm font-semibold">
                {isZh ? "法律" : "Legal"}
              </h3>
              <ul className="space-y-3">
                {footerNav.legal.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {getFooterLinkTitle(link.title, "legal", isZh)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* 底部栏 */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t pt-8 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            {isZh
              ? `© ${new Date().getFullYear()} ${siteConfig.name}。保留所有权利。`
              : `© ${new Date().getFullYear()} ${siteConfig.name}. All rights reserved.`}
          </p>

          {/* 社交链接 */}
          <div className="flex items-center gap-4">
            <Link
              href={siteConfig.links.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Twitter className="h-5 w-5" />
              <span className="sr-only">Twitter</span>
            </Link>
            <Link
              href={siteConfig.links.github}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Github className="h-5 w-5" />
              <span className="sr-only">GitHub</span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
