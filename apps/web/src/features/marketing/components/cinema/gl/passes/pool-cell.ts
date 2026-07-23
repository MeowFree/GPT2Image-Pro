/**
 * 墨池倒影的轨道映射:屏幕横坐标 -> 展墙轨道格序与格内 uv。
 * GLSL(pool.ts FS)与本文件是同一映射的两个实现,改动须双同步。
 * 纯函数无 DOM 依赖,供单测;轨道系全程为视口宽分数(与 stripPos 同单位)。
 */
import {
  STRIP_GAP,
  STRIP_STAGGER,
  STRIP_W,
  STRIP_WHISPER_W,
} from "../../cinema-geometry";

export interface PoolCell {
  /** 格序;-1 = 缝/低语栏位(水面无画) */
  index: number;
  /** 格内横坐标 [0,1] */
  u: number;
  /** 奇偶交错(0 偶 / 1 奇):各格有自己的水线 */
  parity: 0 | 1;
}

/**
 * trackX 为轨道系横坐标(视口宽分数,含 glide 位移后的复原)。
 * whisperAfter 为插有低语栏位的格序;迭代 3 次收敛
 * (低语栏位使后续格右移,格序又决定栏位数,互为因果)。
 */
export function poolCellAt(
  trackX: number,
  count: number,
  whisperAfter: readonly number[]
): PoolCell {
  const pitch = STRIP_W + STRIP_GAP;
  let index = Math.floor((trackX - STRIP_GAP) / pitch);
  for (let k = 0; k < 3; k++) {
    const whispers = whisperAfter.filter((a) => a < index).length;
    index = Math.floor(
      (trackX - STRIP_GAP - whispers * STRIP_WHISPER_W) / pitch
    );
  }
  if (index < 0 || index >= count) return { index: -1, u: 0, parity: 0 };
  const whispers = whisperAfter.filter((a) => a < index).length;
  const cellX = STRIP_GAP + index * pitch + whispers * STRIP_WHISPER_W;
  const u = (trackX - cellX) / STRIP_W;
  if (u < 0 || u > 1) return { index: -1, u: 0, parity: 0 };
  return { index, u, parity: index % 2 === 0 ? 0 : 1 };
}

/** 各格水线(视口高分数):偶格与展厅地面线齐,奇格低 2*STAGGER */
export function poolWaterY(parity: 0 | 1, baseWaterY: number): number {
  return baseWaterY + parity * 2 * STRIP_STAGGER;
}
