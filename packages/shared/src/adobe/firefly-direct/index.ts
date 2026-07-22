/**
 * Adobe Firefly 直连（移植自 adobe2api 的逆向逻辑）公开入口。
 *
 * 与 ../firefly-request.ts / ../firefly-response.ts（外部 adobe2api 网关适配器）并存：
 * - 网关适配器：把请求转给独立的 adobe2api 服务（OpenAI 兼容）。
 * - 本目录（firefly-direct）：把 adobe2api 的逆向逻辑直接搬进本仓库，经 Go TLS 旁路
 *   直连 Adobe Firefly（不依赖外部 adobe2api 进程）。
 */

export * from "./auth";
export * from "./catalog";
export {
  AdobeFireflyClient,
  type AdobeFireflyClientConfig,
  extractResultLink,
  type GenerateImageInput,
  type GenerateImageOutput,
  type GenerateVideoInput,
  type GenerateVideoOutput,
  normalizeVideoPollUrl,
} from "./client";
export * from "./errors";
export * from "./payloads";
export * from "./signing";
export * from "./transport";
export * from "./video-catalog";
