// rect 到视口分数换算:GL 定位画布矩形的唯一坐标事实。
import { describe, expect, it } from "vitest";
import { rectToViewportFractions } from "./dom-sync";

describe("rectToViewportFractions", () => {
  it("满屏元素为 (0,0,1,1)", () => {
    const r = rectToViewportFractions(
      { left: 0, top: 0, width: 1000, height: 800 },
      1000,
      800
    );
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("居中半宽半高元素", () => {
    const r = rectToViewportFractions(
      { left: 250, top: 200, width: 500, height: 400 },
      1000,
      800
    );
    expect(r.x).toBeCloseTo(0.25, 10);
    expect(r.y).toBeCloseTo(0.25, 10);
    expect(r.w).toBeCloseTo(0.5, 10);
    expect(r.h).toBeCloseTo(0.5, 10);
  });

  it("零视口尺寸不产生 NaN", () => {
    const r = rectToViewportFractions(
      { left: 10, top: 10, width: 100, height: 100 },
      0,
      0
    );
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.w)).toBe(true);
  });
});
