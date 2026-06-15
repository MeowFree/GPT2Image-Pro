/** @type {import('next').NextConfig} */
const nextConfig = {
  // 纯 API 应用，standalone 输出用于 Docker 部署
  output: "standalone",
  transpilePackages: [
    "@repo/database",
    "@repo/shared",
    "@repo/image-generation",
  ],
  serverExternalPackages: [
    "sharp",
    "ag-psd",
    "onnxruntime-node",
    "pino",
    "pino-pretty",
    "@axiomhq/pino",
  ],
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
      "./models/isnet.onnx",
    ],
  },
};

export default nextConfig;
