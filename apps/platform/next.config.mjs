import { createMDX } from "fumadocs-mdx/next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * 创建 Fumadocs MDX 插件
 */
const withMDX = createMDX();

/**
 * 创建 next-intl 插件
 * 指定国际化请求配置文件路径
 */
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 营销/文档站无需 standalone output（开发阶段）
  transpilePackages: [
    "@repo/ui",
    "@repo/database",
    "@repo/shared",
    "@repo/image-generation",
  ],
  serverExternalPackages: ["pino", "pino-pretty", "@axiomhq/pino"],
};

// 组合插件: MDX -> NextIntl -> NextConfig
export default withMDX(withNextIntl(nextConfig));
