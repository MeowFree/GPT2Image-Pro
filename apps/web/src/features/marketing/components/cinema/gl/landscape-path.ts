/**
 * 山水飞越相机样条(v1.2 奇观一):全部量为飞行进度 p 的确定性纯函数,
 * 滚回即倒放。世界约定:x 谷道近 0,z 自 +1(谷口)向 -12(远山),
 * y 向上;地形高度 = heightmap * HEIGHT_SCALE(高度图已经 ingest
 * 谷道掩膜,走廊 |x|<0.4 内高度 <= 0.25)。
 */

export const HEIGHT_SCALE = 0.42;

/** 谷道走廊半宽(世界单位),ingest 掩膜中心 0.08..0.35 过渡带对应 */
const CORRIDOR_X = 0.55;

export interface CamFrame {
  pos: readonly [number, number, number];
  look: readonly [number, number, number];
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/**
 * 相机机位:z 匀速纵深(线性推轨的手感);x 为低频 S 形摆动
 * (穿行感,两端收敛归零防起止侧移);y 中段压低谷内穿行、
 * 末端拉起(越过终段山脊前抬头入雾)。
 */
export function landscapeCam(p: number): CamFrame {
  const c = clamp01(p);
  const z = 1 - 11.5 * c;
  const sway =
    Math.sin(c * Math.PI * 2.1) *
    CORRIDOR_X *
    smooth(c * 4) *
    (1 - smooth((c - 0.82) / 0.18));
  const x = sway;
  const cruise = 0.34 - 0.1 * smooth((c - 0.1) / 0.35);
  const pull = 0.55 * smooth((c - 0.78) / 0.2);
  const y = cruise + pull;
  const lookX = x * 0.55 + Math.sin(c * Math.PI * 3.2) * 0.08;
  const lookY = y - 0.07 - 0.1 * smooth((c - 0.78) / 0.2);
  return {
    pos: [x, y, z],
    look: [lookX, lookY, z - 2.4],
  };
}
