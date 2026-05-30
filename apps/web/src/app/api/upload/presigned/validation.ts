/**
 * 预签名上传请求的纯校验逻辑（不依赖 auth / S3 / DB，便于 DB-free 单测）。
 *
 * 使用方：`route.ts` 的 POST 处理器在鉴权通过后调用 validateUploadRequest，
 * 据其结果决定返回 400 错误还是继续生成预签名 URL。
 *
 * 关键约束（WHY）：
 * - 文件大小必须为有限正数且不超过上限，缺失/非法（NaN/Infinity/<=0/超限）一律拒绝，
 *   绝不信任客户端自报的任意值。
 * - Content-Type 由服务端按文件类型派生（见 SAFE_CONTENT_TYPES），忽略客户端传入的
 *   contentType，防止上传方将文档声明为 text/html 等导致存储源上的存储型 XSS。
 */
import { getFileTypeFromName, type SupportedFileType } from "@/lib/file-utils";

/**
 * 允许的文件类型和大小限制
 */
export const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".doc", ".md", ".txt"];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 服务端派生的安全 Content-Type（不信任客户端传入的 contentType，
 * 防止上传方将文档声明为 text/html 等导致存储源上的存储型 XSS）。
 */
export const SAFE_CONTENT_TYPES: Record<SupportedFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  txt: "text/plain",
};

/**
 * 校验输入：仅取处理器实际依赖的字段；contentType 故意不参与（服务端派生）。
 */
export interface UploadRequestInput {
  filename?: unknown;
  fileSize?: unknown;
}

/**
 * 校验失败结果：携带面向调用方的 400 错误文案。
 */
export interface UploadValidationError {
  ok: false;
  error: string;
}

/**
 * 校验成功结果：返回文件类型与服务端派生的安全 Content-Type。
 */
export interface UploadValidationSuccess {
  ok: true;
  fileType: SupportedFileType;
  safeContentType: string;
}

export type UploadValidationResult =
  | UploadValidationError
  | UploadValidationSuccess;

/**
 * 校验预签名上传请求体。
 *
 * @param input 客户端提交的 filename 与 fileSize（类型不可信）
 * @returns ok:true 时附带 fileType 与 safeContentType；ok:false 时附带错误文案
 * @remarks 纯函数，无副作用；失败模式见各分支注释。
 */
export function validateUploadRequest(
  input: UploadRequestInput
): UploadValidationResult {
  const { filename, fileSize } = input;

  // 验证文件名：缺失或非字符串一律拒绝
  if (!filename || typeof filename !== "string") {
    return { ok: false, error: "Filename is required" };
  }

  // 验证文件类型：仅放行白名单扩展名
  const fileType = getFileTypeFromName(filename);
  if (!fileType) {
    return {
      ok: false,
      error: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
    };
  }

  // 验证文件大小（严格：必须是有限正数且不超过上限；缺失/非法一律拒绝）
  if (
    typeof fileSize !== "number" ||
    !Number.isFinite(fileSize) ||
    fileSize <= 0 ||
    fileSize > MAX_FILE_SIZE
  ) {
    return {
      ok: false,
      error: `Invalid file size. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // 服务端派生 Content-Type（忽略客户端声明）
  return { ok: true, fileType, safeContentType: SAFE_CONTENT_TYPES[fileType] };
}
