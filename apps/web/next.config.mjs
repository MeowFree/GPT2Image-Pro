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
  assetPrefix: process.env.NEXT_PUBLIC_ASSET_PREFIX || "",
  images: {
    minimumCacheTTL: 2_592_000,
  },
  // Enable standalone output for Docker deployment
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: "200mb",
    serverActions: {
      bodySizeLimit: "200mb",
    },
  },
  // Transpile monorepo packages
  transpilePackages: ["@repo/ui", "@repo/database", "@repo/shared"],
  // Exclude packages with webpack-specific syntax from server bundling
  serverExternalPackages: [
    "anki-apkg-export",
    "sql.js",
    "pino",
    "pino-pretty",
    "@axiomhq/pino",
  ],
};

// 组合插件: MDX -> NextIntl -> NextConfig
export default withMDX(withNextIntl(nextConfig));
