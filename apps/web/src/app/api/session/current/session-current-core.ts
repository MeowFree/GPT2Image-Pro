/**
 * /api/session/current 的 DB-free 纯逻辑。
 *
 * 职责：集中维护"当前会话用户"的字段投影与待清除的 better-auth cookie 名集合，
 * 使其与 route.ts 解耦，可在不 import @repo/database / next/headers 的前提下单测。
 * 使用方：同目录的 route.ts。
 *
 * WHY：route.ts 顶层 import @repo/database，无法在 DB-free vitest 下直接测试；
 * 而用户投影与 cookie 名单决定登录态权威端点的正确性（删号兜底登出、no-store 缓存），
 * 故将这两块纯逻辑抽到此处守护回归。
 */

/** 当前会话端点接受的用户行（来自 user 表查询，字段与 schema.ts 对齐）。 */
export interface CurrentSessionUserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  /** 是否被封禁，显式纳入以与 better-auth additionalFields 投影保持一致。 */
  banned: boolean;
  /** 封禁原因，未封禁时为 null。 */
  bannedReason: string | null;
}

/** 返回给前端的当前会话用户投影。 */
export interface CurrentSessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  banned: boolean;
  bannedReason: string | null;
}

/**
 * 将 user 表行投影为会话用户对象。
 *
 * WHY：原先 route.ts 内联投影漏掉了 banned/bannedReason（与 layout.tsx 投影、
 * better-auth additionalFields 三处不一致）。集中到此并显式纳入封禁字段，
 * 避免被封禁用户在当前会话端点上看不到封禁态导致的隐性漂移。
 */
export function toCurrentSessionUser(
  row: CurrentSessionUserRow
): CurrentSessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image,
    role: row.role,
    banned: row.banned,
    bannedReason: row.bannedReason,
  };
}

/**
 * 会话失效时需要清除的 better-auth cookie 基础名集合。
 *
 * 同名集合在 middleware.ts 中也有重复（session_token 部分），库升级改名会静默失效；
 * 集中到常量便于审计与同步。带分片后缀的 session_data cookie 通过 isAuthCookieName 的
 * 前缀匹配覆盖。
 */
export const AUTH_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
  "better-auth.session_data",
  "__Secure-better-auth.session_data",
  "better-auth.dont_remember",
  "__Secure-better-auth.dont_remember",
] as const;

const AUTH_COOKIE_NAME_SET = new Set<string>(AUTH_COOKIE_NAMES);

/** session_data 可能被 better-auth 切分为带后缀的分片 cookie（如 .0/.1）。 */
const AUTH_SESSION_DATA_PREFIXES = [
  "better-auth.session_data.",
  "__Secure-better-auth.session_data.",
] as const;

/**
 * 判定给定 cookie 名是否属于需要在登出时清除的 better-auth 会话 cookie。
 *
 * 既匹配固定名集合，也匹配 session_data 的分片后缀，避免浏览器残留可用会话痕迹。
 */
export function isAuthCookieName(name: string): boolean {
  if (AUTH_COOKIE_NAME_SET.has(name)) {
    return true;
  }
  return AUTH_SESSION_DATA_PREFIXES.some((prefix) => name.startsWith(prefix));
}
