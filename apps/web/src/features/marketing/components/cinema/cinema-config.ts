/**
 * 影片行程常量表与窗口纯函数。
 * 全片钉住段的唯一调参点:各幕 vh 预算改这里,窗口分数自动重算。
 * 纯函数无 DOM 依赖,供场景组件与单测共用。
 */

export type SceneKey =
  | "opening"
  | "generate"
  | "macro"
  | "revise"
  | "dive"
  | "manifesto"
  | "invoke"
  | "multiply"
  | "wall"
  | "pick";

export interface SceneDef {
  key: SceneKey;
  lengthVh: number;
}

/**
 * 分镜行程预算(设计稿第四节,v1.0 十幕见第十五节);终幕独立舞台不在此表。
 * v1.0 新增 revise「再改一笔」(对话式编辑:朱笔圈选 + 定稿从圈心生长
 * 覆盖初稿,画布放大交棒段从 macro 尾移入本幕尾)与 invoke「一行调用」
 * (墨底等宽字打出 API 请求,批量响应点亮,承接宣言与增殖的因果);
 * pick 加长容纳装裱后的分层检视一拍。
 */
export const FILM_SCENES: readonly SceneDef[] = [
  { key: "opening", lengthVh: 260 },
  { key: "generate", lengthVh: 360 },
  { key: "macro", lengthVh: 200 },
  { key: "revise", lengthVh: 230 },
  { key: "dive", lengthVh: 200 },
  { key: "manifesto", lengthVh: 240 },
  { key: "invoke", lengthVh: 190 },
  { key: "multiply", lengthVh: 260 },
  { key: "wall", lengthVh: 460 },
  { key: "pick", lengthVh: 220 },
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
