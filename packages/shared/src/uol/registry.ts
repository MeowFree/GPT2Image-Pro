/**
 * UOL Registry - 操作注册表（全局单例）
 *
 * 职责：存储所有通过 defineOperation() 注册的操作定义，
 * 提供按名称获取、按条件过滤的查询接口。
 *
 * 使用方：各业务模块通过 defineOperation 注册操作；
 * invoke.ts 通过 getOperation 获取操作定义执行。
 *
 * 设计决策：
 * - 全局 Map 单例：进程内所有操作共享一个注册表，MCP / 内置 agent / server-action 共用
 * - 注册时查重：防止意外覆盖导致行为不确定
 * - DB-free：注册表纯内存，不依赖任何外部状态
 */
import type { OperationDefinition, OperationDomain } from "./types";

/** 全局操作注册表 */
const REGISTRY = new Map<string, OperationDefinition>();

/**
 * 注册一个操作定义到全局注册表。
 *
 * @param def - 操作定义（含完整 schema、权限、执行体）
 * @returns 原样返回 def（方便 export const op = defineOperation(...)）
 * @throws 如果 name 已被注册则抛出错误（防止静默覆盖）
 */
export function defineOperation<TInput, TOutput>(
  def: OperationDefinition<TInput, TOutput>,
): OperationDefinition<TInput, TOutput> {
  if (REGISTRY.has(def.name)) {
    throw new Error(
      `[UOL] Duplicate operation registration: ${def.name}`,
    );
  }
  REGISTRY.set(def.name, def as OperationDefinition);
  return def;
}

/**
 * 按名称获取操作定义。
 * 未找到返回 undefined（调用方需处理不存在的情况）。
 */
export function getOperation(
  name: string,
): OperationDefinition | undefined {
  return REGISTRY.get(name);
}

/**
 * 列出注册表中的操作，支持可选过滤条件。
 *
 * @param filter.domain - 按业务领域过滤
 * @param filter.readOnly - 按只读标志过滤
 * @param filter.destructive - 按破坏性标志过滤
 */
export function listOperations(filter?: {
  domain?: OperationDomain;
  readOnly?: boolean;
  destructive?: boolean;
}): OperationDefinition[] {
  let ops = Array.from(REGISTRY.values());
  if (filter?.domain) {
    ops = ops.filter((op) => op.domain === filter.domain);
  }
  if (filter?.readOnly !== undefined) {
    ops = ops.filter((op) => op.readOnly === filter.readOnly);
  }
  if (filter?.destructive !== undefined) {
    ops = ops.filter((op) => op.destructive === filter.destructive);
  }
  return ops;
}

/** 获取当前注册表中的操作数量 */
export function getRegistrySize(): number {
  return REGISTRY.size;
}

/**
 * 清空注册表 - 仅用于测试隔离。
 * 生产代码不应调用此函数。
 */
export function clearRegistry(): void {
  REGISTRY.clear();
}
