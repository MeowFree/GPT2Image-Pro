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
  // standalone 输出用于 Docker 多 app 部署
  output: "standalone",
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
