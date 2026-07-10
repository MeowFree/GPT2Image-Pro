// 构图几何纯函数测试:画布主角规格/4x4 网格/展墙横条/矩形插值。
import { describe, expect, it } from "vitest";
import {
  centerSquareRect,
  gridPos,
  mixRect,
  stripPos,
} from "./cinema-geometry";

describe("cinema-geometry", () => {
  it("centerSquareRect 居中且不超 480px", () => {
    const r = centerSquareRect(2000, 1000);
    expect(r.w * 2000).toBeCloseTo(480, 5);
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 10);
    expect(r.y + r.h / 2).toBeCloseTo(0.5, 10);
  });

  it("gridPos 16 格均匀铺满且不重叠", () => {
    const a = gridPos(0, 1600, 900);
    const b = gridPos(5, 1600, 900);
    expect(a.x).toBeLessThan(b.x);
    expect(a.y).toBeLessThan(b.y);
    expect(a.x + a.w).toBeLessThanOrEqual(b.x + 1e-9 + 1);
  });

  it("stripPos x 随 i 单调递增,trackWidth 一致", () => {
    const p0 = stripPos(0, 16, 1600, 900);
    const p1 = stripPos(1, 16, 1600, 900);
    expect(p1.x).toBeGreaterThan(p0.x);
    expect(p0.trackWidth).toBe(p1.trackWidth);
  });

  it("mixRect 端点恒等", () => {
    const a = { x: 0, y: 0, w: 1, h: 1 };
    const b = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(mixRect(a, b, 0)).toEqual(a);
    expect(mixRect(a, b, 1)).toEqual(b);
  });
});
