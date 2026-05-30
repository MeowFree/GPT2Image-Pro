import { describe, expect, it } from "vitest";

import {
  MAX_FILE_SIZE,
  SAFE_CONTENT_TYPES,
  validateUploadRequest,
} from "./validation";

// validateUploadRequest 是预签名上传的安全门闩：拦非法文件名/类型/大小，
// 并服务端派生 Content-Type。这些失败分支原先零覆盖、易在重构时回归
// （如误把校验改回信任客户端 contentType），故逐条断言。
describe("validateUploadRequest", () => {
  it("缺失文件名时拒绝", () => {
    expect(validateUploadRequest({ fileSize: 1 })).toEqual({
      ok: false,
      error: "Filename is required",
    });
  });

  it("非字符串文件名时拒绝", () => {
    expect(validateUploadRequest({ filename: 123, fileSize: 1 })).toEqual({
      ok: false,
      error: "Filename is required",
    });
  });

  it("不支持的扩展名时拒绝", () => {
    const result = validateUploadRequest({
      filename: "evil.exe",
      fileSize: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unsupported file type");
    }
  });

  // 大小校验：非有限数、负数、零、缺失、超限一律拒绝（参数化）。
  it.each([
    ["非数字字符串", "100"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["负数", -1],
    ["零", 0],
    ["缺失", undefined],
    ["超过上限", MAX_FILE_SIZE + 1],
  ])("非法文件大小（%s）时拒绝", (_label, fileSize) => {
    const result = validateUploadRequest({
      filename: "a.pdf",
      fileSize,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid file size");
    }
  });

  it("恰好等于上限的文件大小被接受", () => {
    const result = validateUploadRequest({
      filename: "a.pdf",
      fileSize: MAX_FILE_SIZE,
    });
    expect(result.ok).toBe(true);
  });

  it("服务端派生安全 Content-Type，忽略客户端声明", () => {
    // 客户端即便把文档伪报为 text/html，也只按扩展名派生安全类型。
    // contentType 字段会被忽略（validateUploadRequest 根本不读取它）。
    const input: Record<string, unknown> = {
      filename: "a.pdf",
      fileSize: 1024,
      contentType: "text/html",
    };
    const result = validateUploadRequest(input);
    expect(result).toEqual({
      ok: true,
      fileType: "pdf",
      safeContentType: SAFE_CONTENT_TYPES.pdf,
    });
  });

  it("各受支持类型派生对应的安全 Content-Type", () => {
    expect(validateUploadRequest({ filename: "a.pdf", fileSize: 1 })).toEqual({
      ok: true,
      fileType: "pdf",
      safeContentType: "application/pdf",
    });
    expect(validateUploadRequest({ filename: "a.docx", fileSize: 1 })).toEqual({
      ok: true,
      fileType: "docx",
      safeContentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(validateUploadRequest({ filename: "a.md", fileSize: 1 })).toEqual({
      ok: true,
      fileType: "md",
      safeContentType: "text/markdown",
    });
    expect(validateUploadRequest({ filename: "a.txt", fileSize: 1 })).toEqual({
      ok: true,
      fileType: "txt",
      safeContentType: "text/plain",
    });
  });
});
