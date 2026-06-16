import createNextIntlPlugin from "next-intl/plugin";

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

export default withNextIntl(nextConfig);
