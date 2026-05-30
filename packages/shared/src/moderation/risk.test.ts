import { describe, expect, it } from "vitest";

import {
  ALIYUN_MAX_CONTENT_LENGTH,
  getContentChunks,
  shouldBlockAliyunRisk,
} from "./risk";

describe("shouldBlockAliyunRisk", () => {
  it("blocks when risk level meets or exceeds the plan threshold", () => {
    expect(shouldBlockAliyunRisk("high", "low")).toBe(true);
    expect(shouldBlockAliyunRisk("low", "low")).toBe(true);
    expect(shouldBlockAliyunRisk("medium", "medium")).toBe(true);
  });

  it("allows when risk level is below the plan threshold", () => {
    expect(shouldBlockAliyunRisk("low", "medium")).toBe(false);
    expect(shouldBlockAliyunRisk("none", "low")).toBe(false);
  });

  it("treats an explicit pass as not blocked", () => {
    expect(shouldBlockAliyunRisk("pass", "low")).toBe(false);
    expect(shouldBlockAliyunRisk("PASS", "high")).toBe(false);
  });

  it("blocks unknown non-pass labels (fail-closed on unrecognized risk)", () => {
    expect(shouldBlockAliyunRisk("weirdlabel", "high")).toBe(true);
  });

  it("does not block when the risk level is not a string", () => {
    expect(shouldBlockAliyunRisk(123, "low")).toBe(false);
    expect(shouldBlockAliyunRisk(undefined, "low")).toBe(false);
    expect(shouldBlockAliyunRisk(null, "low")).toBe(false);
  });

  it("normalizes casing before comparing", () => {
    expect(shouldBlockAliyunRisk("HIGH", "low")).toBe(true);
  });
});

describe("getContentChunks", () => {
  it("returns a single chunk for content within the length limit", () => {
    expect(getContentChunks("hello")).toEqual(["hello"]);
  });

  it("returns a single empty chunk for empty content", () => {
    expect(getContentChunks("")).toEqual([""]);
  });

  it("splits content exceeding the max length into multiple chunks", () => {
    const content = "a".repeat(ALIYUN_MAX_CONTENT_LENGTH + 1);
    const chunks = getContentChunks(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(ALIYUN_MAX_CONTENT_LENGTH);
    expect(chunks[1]).toBe("a");
    expect(chunks.join("")).toBe(content);
  });
});
