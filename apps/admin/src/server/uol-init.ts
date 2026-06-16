/**
 * UOL 初始化入口 - 确保所有操作绑定在首次调用前完成
 *
 * 职责：懒加载 uol-bindings 模块，触发所有 bindExecute 调用。
 * 使用模块级标志保证只执行一次（幂等）。
 *
 * 使用方：MCP 路由在处理请求前调用 ensureUolInitialized()，
 * 确保 registry 中的 stub 已被替换。
 *
 * 关键依赖：./uol-bindings（实际绑定逻辑）
 *
 * 注意：此文件与 apps/web/src/server/uol-init.ts 同源。管理后台的绑定集
 * 可按需裁剪（仅绑定管理操作所需的 operation）。
 */

let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * 确保 UOL 操作层已完成初始化（所有 bindExecute 已执行）。
 *
 * 调用时机：任何 invokeOperation 调用之前（通常在传输层入口处）。
 * 多次调用安全（幂等），仅首次触发实际绑定。
 * 并发调用安全（共享同一 Promise）。
 */
export async function ensureUolInitialized(): Promise<void> {
  if (initialized) return;

  if (!initPromise) {
    initPromise = (async () => {
      await import("./uol-bindings");
      initialized = true;
    })();
  }

  await initPromise;
}
