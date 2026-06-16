/**
 * UOL Bindings - 管理后台启动时延迟绑定真实 execute 实现
 *
 * 职责：在 apps/admin 启动时，将 packages/shared 中定义的 operation stub
 * 替换为真实的 service-fn 实现。
 *
 * 与 apps/web 的 uol-bindings 的区别：
 * - 管理后台仅绑定管理操作所需的 operation（pool.getAdminPool 等）
 * - 不绑定 image.generate 等用户侧操作（管理后台不生成图片）
 *
 * 使用方：uol-init.ts 在应用启动时调用此模块（副作用导入）
 * 关键依赖：@repo/shared/uol（bindExecute）、@repo/image-generation service-fn
 */

// 副作用导入：触发所有操作注册到 registry
import "@repo/shared/uol/operations";

import { bindExecute } from "@repo/shared/uol";
import type { Principal, OperationContext } from "@repo/shared/uol";

import { listAdminImageBackendPool } from "@repo/image-generation/image-backend/service";

// ---------------------------------------------------------------------------
// image-backend-pool 域
// ---------------------------------------------------------------------------

/**
 * pool.getAdminPool - 管理后台池总览
 * 源: packages/image-generation/src/image-backend/service.ts
 */
bindExecute(
  "pool.getAdminPool",
  async (
    _input: Record<string, never>,
    _principal: Principal,
    _ctx: OperationContext,
  ) => {
    const pool = await listAdminImageBackendPool();
    return pool;
  },
);

// 管理后台暂只绑定 MCP 路由实际使用的操作。
// 其余操作（user.*、support.* 等）的 execute 实现仍在 packages/shared 中，
// 通过 @repo/shared/uol/operations 的 defineOperation 注册时自带 execute，
// 不需要额外的 bindExecute。
