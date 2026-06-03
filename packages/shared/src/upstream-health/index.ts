/**
 * `@repo/shared/upstream-health` 入口：再导出上游 API 测活探针。
 * 详见 `./probe`。
 */
export {
  probeUpstreamApi,
  type ProbeUpstreamApiInput,
  type UpstreamApiHealthResult,
  type UpstreamApiHealthStatus,
} from "./probe";
