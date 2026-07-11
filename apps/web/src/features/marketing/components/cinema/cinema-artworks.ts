/**
 * 影片样张事实源:增殖网格(scene-multiply)/展墙(scene-wall)/静态回退
 * (static-film)三处消费的 16 格样张清单。三处逐位一致是幕界无跳变
 * 接管的前提,任何一处不得自持副本。
 * index 7(PICKED_INDEX)固定为主角作品「一笔圆」——展墙横移停驻于
 * 视区中段时选中它回中,叙事闭环:终章取回的正是开场生成的那张。
 * 铭牌题名在 messages 的 Cinema.wallTitles,序号与本清单逐位对应。
 */

/** 被选中项:横条视觉中段,转场 C 固定选它回中 */
export const PICKED_INDEX = 7;

/** 16 格样张路径:15 件展墙水墨 + 主角一笔圆(居 PICKED_INDEX) */
export const WALL_CELL_SRCS: readonly string[] = [
  "/cinema/wall/w01.webp",
  "/cinema/wall/w02.webp",
  "/cinema/wall/w03.webp",
  "/cinema/wall/w04.webp",
  "/cinema/wall/w05.webp",
  "/cinema/wall/w06.webp",
  "/cinema/wall/w07.webp",
  "/cinema/artwork-hero.webp",
  "/cinema/wall/w08.webp",
  "/cinema/wall/w09.webp",
  "/cinema/wall/w10.webp",
  "/cinema/wall/w11.webp",
  "/cinema/wall/w12.webp",
  "/cinema/wall/w13.webp",
  "/cinema/wall/w14.webp",
  "/cinema/wall/w15.webp",
];

/** 格序取样张路径,越界回落主角图(理论不可达,满足严格索引检查) */
export function cellSrc(index: number): string {
  return WALL_CELL_SRCS[index] ?? "/cinema/artwork-hero.webp";
}
