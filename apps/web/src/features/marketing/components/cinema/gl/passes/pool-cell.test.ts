import { describe, expect, it } from "vitest";
import { STRIP_GAP, STRIP_W } from "../../cinema-geometry";
import { poolCellAt, poolWaterY } from "./pool-cell";

const WHISPER_AFTER = [3, 8, 12] as const;

describe("poolCellAt 轨道映射", () => {
  it("首格命中:首格中心返回 index 0", () => {
    const c = poolCellAt(STRIP_GAP + STRIP_W / 2, 16, WHISPER_AFTER);
    expect(c.index).toBe(0);
    expect(c.u).toBeCloseTo(0.5, 5);
    expect(c.parity).toBe(0);
  });
  it("缝隙返回 -1(水面无画)", () => {
    const gapX = STRIP_GAP + STRIP_W + STRIP_GAP / 2;
    expect(poolCellAt(gapX, 16, WHISPER_AFTER).index).toBe(-1);
  });
  it("低语栏位后格序右移收敛:cell 5 中心应返回 5", () => {
    // cell 5 在 WHISPER_AFTER=[3,...] 之后,x 含一个低语栏位宽
    const pitch = STRIP_W + STRIP_GAP;
    const cellX = STRIP_GAP + 5 * pitch + 1 * 0.16;
    const c = poolCellAt(cellX + STRIP_W / 2, 16, WHISPER_AFTER);
    expect(c.index).toBe(5);
    expect(c.parity).toBe(1);
  });
  it("越界:轨道外返回 -1", () => {
    expect(poolCellAt(-0.5, 16, WHISPER_AFTER).index).toBe(-1);
    expect(poolCellAt(99, 16, WHISPER_AFTER).index).toBe(-1);
  });
  it("末格命中:16 格轨道末格中心返回 15", () => {
    const pitch = STRIP_W + STRIP_GAP;
    const cellX = STRIP_GAP + 15 * pitch + 3 * 0.16;
    const c = poolCellAt(cellX + STRIP_W / 2, 16, WHISPER_AFTER);
    expect(c.index).toBe(15);
  });
});

describe("poolWaterY", () => {
  it("奇偶水线差 2*STAGGER=0.09", () => {
    expect(poolWaterY(1, 0.8) - poolWaterY(0, 0.8)).toBeCloseTo(0.09, 9);
  });
});
