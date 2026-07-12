/**
 * 影片行程常量表与窗口纯函数。
 * 全片钉住段的唯一调参点:各幕 vh 预算改这里,窗口分数自动重算。
 * 纯函数无 DOM 依赖,供场景组件与单测共用。
 */

export type SceneKey =
  | "opening"
  | "generate"
  | "macro"
  | "dive"
  | "manifesto"
  | "multiply"
  | "wall"
  | "pick";

export interface SceneDef {
  key: SceneKey;
  lengthVh: number;
}

/**
 * 分镜行程预算(设计稿第四节,v0.9 八幕见第十四节);终幕独立舞台不在此表。
 * v0.9 新增 macro 凝视幕(money shot 之后推进笔触局部再拉回放大全屏,
 * 与 dive 无缝交接),opening 加长容纳活墨洇开,pick 加长容纳装裱一拍。
 */
export const FILM_SCENES: readonly SceneDef[] = [
  { key: "opening", lengthVh: 260 },
  { key: "generate", lengthVh: 360 },
  { key: "macro", lengthVh: 210 },
  { key: "dive", lengthVh: 200 },
  { key: "manifesto", lengthVh: 240 },
  { key: "multiply", lengthVh: 250 },
  { key: "wall", lengthVh: 460 },
  { key: "pick", lengthVh: 170 },
] as const;

export function filmTotalVh(scenes: readonly SceneDef[] = FILM_SCENES) {
  return scenes.reduce((acc, s) => acc + s.lengthVh, 0);
}

/** 幕在主进度 [0,1] 中的窗口分数 */
export function sceneWindow(
  key: SceneKey,
  scenes: readonly SceneDef[] = FILM_SCENES
): { start: number; end: number } {
  const total = filmTotalVh(scenes);
  let cursor = 0;
  for (const s of scenes) {
    const next = cursor + s.lengthVh / total;
    if (s.key === key) return { start: cursor, end: next };
    cursor = next;
  }
  throw new Error(`未知幕: ${key}`);
}

/** 主进度 -> 幕内进度(窗口外钳制) */
export function sceneProgress(master: number, key: SceneKey): number {
  const { start, end } = sceneWindow(key);
  if (master <= start) return 0;
  if (master >= end) return 1;
  return (master - start) / (end - start);
}

/** 0->1->0 的对称钟形,用于"途中量"(粒子扰动/光痕强度) */
export function bell(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return 1 - Math.abs(c * 2 - 1);
}

/**
 * 影片暗场窗口(主进度分数):穿越压暗起点 -> 增殖回纸点。
 * 页头退场(HeaderDimmer)与章节导轨反色共用本窗口,单一事实。
 */
export function darkWindow(): { start: number; end: number } {
  const dive = sceneWindow("dive");
  const multiply = sceneWindow("multiply");
  return {
    start: dive.start + (dive.end - dive.start) * 0.6,
    end: multiply.start + (multiply.end - multiply.start) * 0.55,
  };
}
