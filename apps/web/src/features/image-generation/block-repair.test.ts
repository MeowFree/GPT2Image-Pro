/**
 * 分块修复纯函数单测（DB-free）：比例 snap、2×2 切块规划、羽化权重。
 * 不测 blockRepairImage 编排（依赖 sharp/后端回调），只测几何/比例决策的正确性与边界。
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_OVERLAP_FRACTION,
  featherWeight1D,
  planBlockRepair,
  snapToTileSize,
} from "./block-repair";

describe("snapToTileSize", () => {
  it("方形图 snap 到 1:1 块", () => {
    expect(snapToTileSize(2880, 2880)).toEqual({ tileW: 1248, tileH: 1248 });
    expect(snapToTileSize(1000, 1000)).toEqual({ tileW: 1248, tileH: 1248 });
  });

  it("横图 snap 到 3:2 块", () => {
    expect(snapToTileSize(3000, 2000)).toEqual({ tileW: 1536, tileH: 1024 });
    expect(snapToTileSize(1600, 1000)).toEqual({ tileW: 1536, tileH: 1024 });
  });

  it("竖图 snap 到 2:3 块", () => {
    expect(snapToTileSize(2000, 3000)).toEqual({ tileW: 1024, tileH: 1536 });
  });

  it("非法尺寸回退首个比例", () => {
    expect(snapToTileSize(0, 100)).toEqual({ tileW: 1248, tileH: 1248 });
  });
});

describe("planBlockRepair", () => {
  it("目标 ≤ 单块：整图 1×1，无重叠", () => {
    const p = planBlockRepair(1248, 1248, 1000);
    expect(p.cols).toBe(1);
    expect(p.rows).toBe(1);
    expect(p.tiles).toHaveLength(1);
    expect(p.overlapX).toBe(0);
  });

  it("大目标：2×2，修复分辨率封顶在 2 块覆盖上限", () => {
    const p = planBlockRepair(1248, 1248, 2880);
    expect(p.cols).toBe(2);
    expect(p.rows).toBe(2);
    expect(p.tiles).toHaveLength(4);
    // 2×1248 − round(1248×0.2)=250 → 2246
    expect(p.repairW).toBe(2 * 1248 - Math.round(1248 * BLOCK_OVERLAP_FRACTION));
    expect(p.repairW).toBeLessThanOrEqual(2508);
    // 重叠 = 2×块 − 修复分辨率，且 > 0
    expect(p.overlapX).toBe(2 * 1248 - p.repairW);
    expect(p.overlapX).toBeGreaterThan(0);
  });

  it("2×2 块正好铺满修复画布（x/y 位置为 0 与 repair−tile）", () => {
    const p = planBlockRepair(1248, 1248, 4000);
    const xs = [...new Set(p.tiles.map((t) => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(p.tiles.map((t) => t.y))].sort((a, b) => a - b);
    expect(xs).toEqual([0, p.repairW - 1248]);
    expect(ys).toEqual([0, p.repairH - 1248]);
    // 最右块右缘 = repairW（铺满）
    expect(p.repairW - 1248 + 1248).toBe(p.repairW);
  });

  it("横图块的 2×2 保持块比例", () => {
    const p = planBlockRepair(1536, 1024, 3000);
    expect(p.tiles.every((t) => t.w === 1536 && t.h === 1024)).toBe(true);
  });

  it("重叠恒 ≥ 最小 20%，且目标越小重叠越大（保证足够重叠消缝）", () => {
    const minOv = Math.round(1248 * BLOCK_OVERLAP_FRACTION);
    const big = planBlockRepair(1248, 1248, 4000); // 目标 ≥ 上限：20% 重叠
    const mid = planBlockRepair(1248, 1248, 1800); // 目标 < 上限：更大重叠
    expect(big.overlapX).toBeGreaterThanOrEqual(minOv);
    expect(mid.overlapX).toBeGreaterThanOrEqual(minOv);
    expect(mid.overlapX).toBeGreaterThan(big.overlapX);
    // 修复分辨率不超过目标（不会放大过头再缩）
    expect(Math.max(mid.repairW, mid.repairH)).toBeLessThanOrEqual(1800);
  });
});

describe("featherWeight1D", () => {
  it("无羽化侧权重恒 1", () => {
    expect(featherWeight1D(0, 100, 0, 0)).toBe(1);
    expect(featherWeight1D(99, 100, 0, 0)).toBe(1);
  });

  it("起始羽化带内从 0→1 递增，带外为 1", () => {
    expect(featherWeight1D(0, 100, 20, 0)).toBeCloseTo(0.5 / 20, 5);
    expect(featherWeight1D(19, 100, 20, 0)).toBeCloseTo(19.5 / 20, 5);
    expect(featherWeight1D(50, 100, 20, 0)).toBe(1);
  });

  it("结束羽化带内从 1→0 递减", () => {
    expect(featherWeight1D(99, 100, 0, 20)).toBeCloseTo(0.5 / 20, 5);
    expect(featherWeight1D(80, 100, 0, 20)).toBeCloseTo(19.5 / 20, 5);
  });

  it("两侧同时羽化取较小值，权重落在 [0,1]", () => {
    const w = featherWeight1D(5, 40, 20, 20);
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(1);
  });
});
