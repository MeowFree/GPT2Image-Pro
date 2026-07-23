import { describe, expect, it } from "vitest";
import { HEIGHT_SCALE, landscapeCam } from "./landscape-path";

describe("landscapeCam 相机样条", () => {
  it("端点:p=0 在谷口外,p=1 抵近终段山脊", () => {
    const a = landscapeCam(0);
    const b = landscapeCam(1);
    expect(a.pos[2]).toBeGreaterThan(0.5);
    expect(b.pos[2]).toBeLessThan(-9.5);
  });
  it("前进单调:z 随 p 严格减小", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 100; i++) {
      const { pos } = landscapeCam(i / 100);
      expect(pos[2]).toBeLessThan(prev);
      prev = pos[2];
    }
  });
  it("相机恒在谷道走廊内且高于最低安全高度", () => {
    for (let i = 0; i <= 100; i++) {
      const { pos } = landscapeCam(i / 100);
      expect(Math.abs(pos[0])).toBeLessThan(0.7);
      expect(pos[1]).toBeGreaterThan(0.25 * HEIGHT_SCALE + 0.05);
    }
  });
  it("视点恒在相机前方", () => {
    for (let i = 0; i <= 100; i++) {
      const { pos, look } = landscapeCam(i / 100);
      expect(look[2]).toBeLessThan(pos[2]);
    }
  });
  it("纯函数:同参同出(倒放成立的根基)", () => {
    const a = landscapeCam(0.37);
    const b = landscapeCam(0.37);
    expect(a.pos).toEqual(b.pos);
    expect(a.look).toEqual(b.look);
  });
});
