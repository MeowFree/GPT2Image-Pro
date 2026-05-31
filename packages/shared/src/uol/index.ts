/**
 * UOL (Unified Operation Layer) - 统一操作层桶导出
 *
 * 职责：作为 @repo/shared/uol 的唯一入口，聚合导出所有 UOL 公共 API。
 * 外部消费者通过此文件获取类型定义、注册函数、调用网关等。
 */
export * from "./types";
export * from "./principal";
export * from "./errors";
export * from "./registry";
export * from "./access";
export * from "./invoke";
