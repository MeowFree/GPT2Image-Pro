import { describe, expect, it } from "vitest";
import { quantizeTone } from "./chunks";

describe("quantizeTone（inkTone 的 JS 镜像，锁墨分五色数值契约）", () => {
  it("端点:纯黑为 0,纯纸白为 1", () => {
    expect(quantizeTone(0, 0)).toBe(0);
    expect(quantizeTone(1, 0)).toBe(1);
  });
  it("单调:亮度升,墨阶不降", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = quantizeTone(i / 20, 0.5);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("量化:输出落在 1/levels 网格上", () => {
    for (let i = 0; i <= 100; i++) {
      const v = quantizeTone(i / 100, 0);
      const grid = Math.round(v * 5) / 5;
      expect(Math.abs(v - grid)).toBeLessThan(1e-9);
    }
  });
  it("噪声项有界:|quantizeTone(lum,1) - quantizeTone(lum,0)| <= 1/levels", () => {
    for (let i = 0; i <= 100; i++) {
      const lum = i / 100;
      const diff = Math.abs(quantizeTone(lum, 1) - quantizeTone(lum, 0));
      expect(diff).toBeLessThanOrEqual(1 / 5 + 1e-9);
    }
  });
});
