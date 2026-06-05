/**
 * 全局状态数据缓存的 tag。
 *
 * page.tsx 用 unstable_cache(..., { tags: [GLOBAL_STATUS_CACHE_TAG] }) 缓存重聚合;
 * 手动刷新 action 用 revalidateTag(GLOBAL_STATUS_CACHE_TAG) 失效之。单点定义避免
 * 魔法字符串两处漂移。
 */
export const GLOBAL_STATUS_CACHE_TAG = "admin-global-status";
