import { describe, expect, it } from "vitest";
import { resolveImageModelMultiplier } from "./image-pricing";

describe("resolveImageModelMultiplier", () => {
  it("firefly 模型按族取倍率", () => {
    expect(
      resolveImageModelMultiplier("firefly-gpt-image-2", { "gpt-image-2": 2 })
    ).toBe(2);
  });

  it("配置缺该族时回退 1", () => {
    expect(resolveImageModelMultiplier("firefly-nano-banana-pro", {})).toBe(1);
  });

  it("非 firefly 模型恒返回 1", () => {
    expect(
      resolveImageModelMultiplier("gpt-image-2", { "gpt-image-2": 2 })
    ).toBe(1);
  });

  it("最长前缀优先匹配（gpt-image-2 vs gpt-image-1.5）", () => {
    const map = { "gpt-image-2": 3, "gpt-image-1.5": 5 };
    expect(resolveImageModelMultiplier("firefly-gpt-image-2", map)).toBe(3);
    expect(resolveImageModelMultiplier("firefly-gpt-image-1.5", map)).toBe(5);
  });

  it("最长前缀优先匹配（nano-banana vs nano-banana-pro / nano-banana2）", () => {
    const map = {
      "nano-banana": 2,
      "nano-banana-pro": 4,
      "nano-banana2": 6,
    };
    expect(resolveImageModelMultiplier("firefly-nano-banana", map)).toBe(2);
    expect(resolveImageModelMultiplier("firefly-nano-banana-pro", map)).toBe(4);
    expect(resolveImageModelMultiplier("firefly-nano-banana2", map)).toBe(6);
  });

  it("非正/非法倍率回退 1", () => {
    const map = { "gpt-image-2": -3, "nano-banana": 0 };
    expect(resolveImageModelMultiplier("firefly-gpt-image-2", map)).toBe(1);
    expect(resolveImageModelMultiplier("firefly-nano-banana", map)).toBe(1);
  });

  it("空/缺省入参安全", () => {
    expect(resolveImageModelMultiplier(null, { "gpt-image-2": 2 })).toBe(1);
    expect(resolveImageModelMultiplier("firefly-gpt-image-2", null)).toBe(1);
    expect(resolveImageModelMultiplier(undefined, undefined)).toBe(1);
  });
});
