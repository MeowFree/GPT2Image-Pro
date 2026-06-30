import { describe, expect, it } from "vitest";

import {
  appendImagesUpstreamNonce,
  buildInvisibleNonce,
} from "./openai-prompt-cache";

// 零宽字符集合（与实现一致），用于剥离后校验可见文本。
const ZERO_WIDTH = /\u200b|\u200c|\u200d|\u2060/g;

describe("appendImagesUpstreamNonce（打掉上游 images 内容缓存）", () => {
  it("可见文本保持不变：剥离零宽 nonce 后等于原 prompt", () => {
    const prompt = "a cute cat sitting on the sofa";
    const out = appendImagesUpstreamNonce(prompt);
    expect(out.startsWith(prompt)).toBe(true);
    expect(out.replace(ZERO_WIDTH, "")).toBe(prompt);
  });

  it("复现并修复：同一参考图+同一提示词两次调用，发往上游的 prompt 不再逐字节相同", () => {
    const prompt = "same reference image, same prompt words";
    const first = appendImagesUpstreamNonce(prompt);
    const second = appendImagesUpstreamNonce(prompt);
    // 修复前 images 直连路径对同输入发出逐字节相同的 body → 上游按内容缓存命中
    // 返回同一张旧图；注入每请求唯一零宽 nonce 后两次内容不同，缓存无法命中。
    expect(first).not.toBe(second);
  });

  it("追加的后缀仅含零宽字符（对出图无可见影响）", () => {
    const prompt = "x";
    const suffix = appendImagesUpstreamNonce(prompt).slice(prompt.length);
    expect(suffix.length).toBeGreaterThan(0);
    expect(suffix.replace(ZERO_WIDTH, "")).toBe("");
  });

  it("buildInvisibleNonce 多次调用均唯一且非空", () => {
    const nonces = Array.from({ length: 100 }, () => buildInvisibleNonce());
    expect(new Set(nonces).size).toBe(100);
    expect(nonces.every((n) => n.length > 0)).toBe(true);
  });
});
