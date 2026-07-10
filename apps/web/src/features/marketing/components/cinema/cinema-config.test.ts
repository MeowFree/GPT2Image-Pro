// 影片行程表纯函数测试:窗口切分正确性与边界钳制。
import { describe, expect, it } from "vitest";
import {
  bell,
  FILM_SCENES,
  filmTotalVh,
  sceneProgress,
  sceneWindow,
} from "./cinema-config";

describe("cinema-config", () => {
  it("行程总长等于各幕之和", () => {
    const sum = FILM_SCENES.reduce((a, s) => a + s.lengthVh, 0);
    expect(filmTotalVh()).toBe(sum);
    // 设计稿第四节行程预算:主舞台 1550vh(钉住段 1750vh 减去终幕独立 200vh)
    expect(filmTotalVh()).toBe(1550);
  });

  it("窗口首尾相接且覆盖 [0,1]", () => {
    let cursor = 0;
    for (const s of FILM_SCENES) {
      const w = sceneWindow(s.key);
      expect(w.start).toBeCloseTo(cursor, 10);
      cursor = w.end;
    }
    expect(cursor).toBeCloseTo(1, 10);
  });

  it("幕内进度在窗口外钳制为 0/1,窗口内线性", () => {
    const w = sceneWindow("generate");
    expect(sceneProgress(w.start - 0.01, "generate")).toBe(0);
    expect(sceneProgress(w.end + 0.01, "generate")).toBe(1);
    const mid = (w.start + w.end) / 2;
    expect(sceneProgress(mid, "generate")).toBeCloseTo(0.5, 10);
  });

  it("bell 在 0/1 为 0,0.5 为 1,对称", () => {
    expect(bell(0)).toBe(0);
    expect(bell(1)).toBe(0);
    expect(bell(0.5)).toBe(1);
    expect(bell(0.25)).toBeCloseTo(bell(0.75), 10);
  });
});
