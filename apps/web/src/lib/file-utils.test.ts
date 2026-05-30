import { describe, expect, it } from "vitest";

import { getFileTypeFromMime, getFileTypeFromName } from "./file-utils";

// getFileTypeFromName 是预签名上传白名单的唯一类型判定点：
// 决定"是否允许上传 + 用哪个安全 MIME"。回归会直接放行/误拒上传类型，
// 故对扩展名解析的各边界（大小写、多点、无扩展、未知扩展）逐一断言。
describe("getFileTypeFromName", () => {
  it("识别小写扩展名", () => {
    expect(getFileTypeFromName("report.pdf")).toBe("pdf");
    expect(getFileTypeFromName("report.docx")).toBe("docx");
    expect(getFileTypeFromName("notes.md")).toBe("md");
    expect(getFileTypeFromName("notes.txt")).toBe("txt");
  });

  it("大小写归一后识别（.PDF → pdf）", () => {
    expect(getFileTypeFromName("doc.PDF")).toBe("pdf");
    expect(getFileTypeFromName("Report.DOCX")).toBe("docx");
  });

  it("多点文件名仅取最后一段扩展名（a.tar.txt → txt）", () => {
    expect(getFileTypeFromName("a.tar.txt")).toBe("txt");
    expect(getFileTypeFromName("archive.backup.pdf")).toBe("pdf");
  });

  it("无扩展名返回 null", () => {
    expect(getFileTypeFromName("noext")).toBeNull();
  });

  it("未知扩展名返回 null", () => {
    expect(getFileTypeFromName("a.exe")).toBeNull();
    expect(getFileTypeFromName("image.png")).toBeNull();
  });

  it("空文件名返回 null", () => {
    expect(getFileTypeFromName("")).toBeNull();
  });

  it("纯 dotfile 形式按扩展名解析（.txt → txt）", () => {
    // 正则 /\.[^.]+$/ 对 ".txt" 匹配出 ".txt"，故视为受支持类型。
    expect(getFileTypeFromName(".txt")).toBe("txt");
  });
});

// getFileTypeFromMime 是 MIME → 文件类型的反向映射，覆盖合法与未知输入。
describe("getFileTypeFromMime", () => {
  it("识别受支持的 MIME 类型", () => {
    expect(getFileTypeFromMime("application/pdf")).toBe("pdf");
    expect(
      getFileTypeFromMime(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("docx");
    expect(getFileTypeFromMime("text/markdown")).toBe("md");
    expect(getFileTypeFromMime("text/plain")).toBe("txt");
  });

  it("未知 MIME 类型返回 null", () => {
    expect(getFileTypeFromMime("text/html")).toBeNull();
    expect(getFileTypeFromMime("image/png")).toBeNull();
    expect(getFileTypeFromMime("")).toBeNull();
  });
});
