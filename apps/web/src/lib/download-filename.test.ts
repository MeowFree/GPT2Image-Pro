import { describe, expect, it } from "vitest";
import { generateDownloadFilename } from "./download-filename";

describe("generateDownloadFilename", () => {
  it("格式为 gpt2image_<8位hash>_T<date>d<time>.<ext>", () => {
    const result = generateDownloadFilename(
      "a cat sitting on a roof",
      "2026-06-19T14:30:52.000Z"
    );
    expect(result).toMatch(
      /^gpt2image_[a-z0-9]{8}_T\d{4}_\d{2}_\d{2}d\d{2}_\d{2}_\d{2}\.png$/
    );
  });

  it("同一 prompt 产生相同哈希", () => {
    const a = generateDownloadFilename("hello world", "2026-01-01T00:00:00Z");
    const b = generateDownloadFilename("hello world", "2026-06-19T12:00:00Z");
    const hashA = a.split("_")[1];
    const hashB = b.split("_")[1];
    expect(hashA).toBe(hashB);
  });

  it("不同 prompt 产生不同哈希", () => {
    const a = generateDownloadFilename("a cat", "2026-01-01T00:00:00Z");
    const b = generateDownloadFilename("a dog", "2026-01-01T00:00:00Z");
    const hashA = a.split("_")[1];
    const hashB = b.split("_")[1];
    expect(hashA).not.toBe(hashB);
  });

  it("自定义扩展名", () => {
    const result = generateDownloadFilename(
      "test",
      "2026-06-19T14:30:52.000Z",
      "psd"
    );
    expect(result).toMatch(/\.psd$/);
  });

  it("空 prompt 不报错", () => {
    const result = generateDownloadFilename("", "2026-06-19T14:30:52.000Z");
    expect(result).toMatch(
      /^gpt2image_[a-z0-9]{8}_T\d{4}_\d{2}_\d{2}d\d{2}_\d{2}_\d{2}\.png$/
    );
  });

  it("无效时间回退到 sanitize 字符串", () => {
    const result = generateDownloadFilename("test", "invalid-date");
    expect(result).toMatch(/^gpt2image_[a-z0-9]{8}_invaliddate\.png$/);
  });

  it("纯函数:相同输入永远产出相同文件名", () => {
    const a = generateDownloadFilename("sunset", "2026-06-19T08:00:00Z");
    const b = generateDownloadFilename("sunset", "2026-06-19T08:00:00Z");
    expect(a).toBe(b);
  });
});
