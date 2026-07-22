// 生图超时相关的纯常量与纯函数（无 DB / 无副作用导入）。
//
// WHY 单独成文件：这些值既被带 DB 的 generation-maintenance（pending 清扫）使用，也被
// 纯分类器 sla-classification（SLA 归因，禁止拉 DB 连接）使用。若放在 generation-maintenance
// 里，分类器 import 会经其 `import { db }` 把数据库连接拖进纯路径（无 DATABASE_URL 即抛错）。
// 故抽到 db-free 模块，两侧各取所需。

// 文案须与 generation_error 结算行为一致：退生成费、保留已发生的审核费
// （getFailedGenerationTargetCredits 对 generation_error 保留 moderationOnlyCredits），
// 不能笼统地说 "credits were refunded"。
export const IMAGE_GENERATION_TIMEOUT_ERROR =
  "Image generation timed out after 20 minutes. The image generation fee was refunded; any moderation fee already incurred was retained.";

// 保留 Web 专用常量名以兼容已有调用方，但 Web 超时与其他后端超时统一归为平台错误。
export const IMAGE_GENERATION_WEB_TIMEOUT_ERROR =
  IMAGE_GENERATION_TIMEOUT_ERROR;

// 保留 backend 参数以兼容已有调用方；所有后端统一使用平台超时文案。
export function resolveImageGenerationTimeoutError(
  _backend?: { type?: string | null; accountBackend?: string | null } | null
): string {
  return IMAGE_GENERATION_TIMEOUT_ERROR;
}
