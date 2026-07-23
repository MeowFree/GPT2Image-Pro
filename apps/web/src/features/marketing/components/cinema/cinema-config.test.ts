// 影片行程表纯函数测试:窗口切分正确性与边界钳制。
import { describe, expect, it } from "vitest";
import {
  bell,
  darkWindow,
  FILM_SCENES,
  filmTotalVh,
  sceneProgress,
  sceneWindow,
} from "./cinema-config";

describe("cinema-config", () => {
  it("行程总长等于各幕之和", () => {
    const sum = FILM_SCENES.reduce((a, s) => a + s.lengthVh, 0);
    expect(filmTotalVh()).toBe(sum);
    // v1.2 行程预算:dive 自 200 扩为 320vh(入画飞越分镜),
    // 主舞台总行程 3110 -> 3230vh(不含终幕独立舞台)
    expect(filmTotalVh()).toBe(3230);
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

  it("darkWindow 起终点咬合 dive/multiply 幕内时点", () => {
    // v1.2:暗场自墨潮回灌起(dive 内 0.92),到增殖回纸点(multiply 内
    // 0.55)止;期望经 sceneWindow 现算,不钉魔术分数(行程改时自动跟随)
    const dive = sceneWindow("dive");
    const multiply = sceneWindow("multiply");
    const w = darkWindow();
    expect(w.start).toBeCloseTo(
      dive.start + (dive.end - dive.start) * 0.92,
      10
    );
    expect(w.end).toBeCloseTo(
      multiply.start + (multiply.end - multiply.start) * 0.55,
      10
    );
  });
});
