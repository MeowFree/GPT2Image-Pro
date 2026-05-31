/**
 * UOL 错误类型 - 操作层统一错误码与异常类
 *
 * 职责：定义操作执行中所有可能的错误类型及其 HTTP 状态码映射。
 * OperationError 是整个 UOL 链路的唯一错误载体，传输层据此编码响应。
 *
 * 使用方：invoke.ts（错误映射）、access.ts（鉴权失败）、各 operation execute
 * 关键依赖：无外部依赖
 */

/**
 * 操作错误码 - 覆盖所有业务与系统错误场景。
 * 每个错误码对应明确的 HTTP 状态码与客户端可解析的语义。
 */
export type OperationErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "capability_required"
  | "not_found"
  | "ownership_violation"
  | "insufficient_credits"
  | "account_frozen"
  | "quota_exceeded"
  | "validation_error"
  | "idempotency_conflict"
  | "rate_limited"
  | "upstream_error"
  | "moderation_blocked"
  | "internal_error";

/**
 * 操作错误 - UOL 链路的统一异常类。
 *
 * 传输层捕获此异常后根据 code 映射 HTTP 状态码，
 * details 提供结构化附加信息（如校验失败的字段列表）。
 *
 * @param code - 错误码（决定客户端处理策略）
 * @param message - 面向开发者的错误描述
 * @param details - 可选结构化附加信息
 * @param httpStatus - 可选覆盖默认 HTTP 状态码
 */
export class OperationError extends Error {
  readonly code: OperationErrorCode;
  readonly details?: Record<string, unknown> | undefined;
  readonly httpStatus: number;

  constructor(
    code: OperationErrorCode,
    message: string,
    details?: Record<string, unknown>,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "OperationError";
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus ?? getDefaultHttpStatus(code);
  }
}

/** 错误码到 HTTP 状态码的默认映射 */
const CODE_TO_STATUS: Record<OperationErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  capability_required: 403,
  not_found: 404,
  ownership_violation: 403,
  insufficient_credits: 402,
  account_frozen: 403,
  quota_exceeded: 429,
  validation_error: 400,
  idempotency_conflict: 409,
  rate_limited: 429,
  upstream_error: 502,
  moderation_blocked: 451,
  internal_error: 500,
};

/**
 * 获取错误码对应的默认 HTTP 状态码。
 * 未知码回退 500。
 */
export function getDefaultHttpStatus(code: OperationErrorCode): number {
  return CODE_TO_STATUS[code] ?? 500;
}
