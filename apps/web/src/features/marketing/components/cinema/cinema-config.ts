/**
 * 影片行程常量表与窗口纯函数。
 * 全片钉住段的唯一调参点:各幕 vh 预算改这里,窗口分数自动重算。
 * 纯函数无 DOM 依赖,供场景组件与单测共用。
 */

export type SceneKey =
  | "opening"
  | "generate"
  | "dive"
  | "manifesto"
  | "multiply"
  | "wall"
  | "pick";

export interface SceneDef {
  key: SceneKey;
  lengthVh: number;
}

/** 分镜行程预算(设计稿第四节);终幕独立 200vh 舞台不在此表 */
export const FILM_SCENES: readonly SceneDef[] = [
  { key: "opening", lengthVh: 200 },
  { key: "generate", lengthVh: 300 },
  { key: "dive", lengthVh: 150 },
  { key: "manifesto", lengthVh: 200 },
  { key: "multiply", lengthVh: 200 },
  { key: "wall", lengthVh: 400 },
  { key: "pick", lengthVh: 100 },
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
