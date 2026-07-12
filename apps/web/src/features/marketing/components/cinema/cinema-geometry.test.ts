// 构图几何纯函数测试:画布主角规格/4x4 网格/展墙横条/矩形插值/
// 形制变换/入匣下沉。
import { describe, expect, it } from "vitest";
import {
  archiveChestRect,
  archiveDrop,
  centerSquareRect,
  FRAME_HOLDS,
  frameRect,
  gridPos,
  mixRect,
  stripPos,
  stripWhisperSlot,
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

  it("低语栏位使其后格顺延,栏位落在两格之间且同轨宽", () => {
    const whispers = [3] as const;
    const before = stripPos(3, 16, 1600, 900, whispers);
    const after = stripPos(4, 16, 1600, 900, whispers);
    const plain = stripPos(4, 16, 1600, 900);
    // 第 4 格因栏位顺延,比无栏位布局更靠右
    expect(after.x).toBeGreaterThan(plain.x);
    const slot = stripWhisperSlot(3, 16, 1600, 900, whispers);
    expect(slot.x).toBeGreaterThan(before.x + before.w);
    expect(slot.x + slot.w).toBeLessThan(after.x);
    expect(slot.trackWidth).toBe(before.trackWidth);
  });

  it("mixRect 端点恒等", () => {
    const a = { x: 0, y: 0, w: 1, h: 1 };
    const b = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(mixRect(a, b, 0)).toEqual(a);
    expect(mixRect(a, b, 1)).toEqual(b);
  });

  it("frameRect 首尾回归画布主角规格(前后幕逐位咬合)", () => {
    const square = centerSquareRect(1280, 900);
    expect(frameRect(0, 1280, 900)).toEqual(square);
    expect(frameRect(1, 1280, 900)).toEqual(square);
  });

  it("frameRect 三段停拍分别为横批/立轴/斗方且比例正确", () => {
    const vw = 1280;
    const vh = 900;
    const holds = FRAME_HOLDS.map((h) =>
      frameRect((h.start + h.end) / 2, vw, vh)
    );
    const ratio = (r: { w: number; h: number }) => (r.w * vw) / (r.h * vh);
    expect(ratio(holds[0] ?? { w: 1, h: 1 })).toBeCloseTo(16 / 9, 5);
    expect(ratio(holds[1] ?? { w: 1, h: 1 })).toBeCloseTo(9 / 16, 5);
    expect(ratio(holds[2] ?? { w: 1, h: 1 })).toBeCloseTo(1, 5);
    // 停拍矩形均居中
    for (const r of holds) {
      expect(r.x + r.w / 2).toBeCloseTo(0.5, 10);
      expect(r.y + r.h / 2).toBeCloseTo(0.5, 10);
    }
  });

  it("archiveDrop 起点承接方形,悬停位画底贴匣口,终点全没", () => {
    const vw = 1280;
    const vh = 900;
    const square = centerSquareRect(vw, vh);
    const start = archiveDrop(0, vw, vh);
    expect(start.rect).toEqual(square);
    expect(start.sink).toBe(0);
    const hover = archiveDrop(0.5, vw, vh);
    const chest = archiveChestRect(vw, vh);
    expect(hover.rect.y + hover.rect.h).toBeCloseTo(chest.y, 5);
    expect(hover.sink).toBe(0);
    const end = archiveDrop(1, vw, vh);
    expect(end.sink).toBe(1);
    // 全没时画顶到达匣口平面
    expect(end.rect.y).toBeCloseTo(chest.y, 5);
  });
});
