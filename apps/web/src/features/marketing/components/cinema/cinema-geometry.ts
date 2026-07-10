/**
 * 构图几何纯函数:画布主角规格、4x4 增殖网格、展墙横条、矩形插值。
 * WHY 单一构图事实:序幕画布、增殖粒子源矩形、终幕 bookend 共用
 * centerSquareRect;增殖 DOM 网格与展墙起始格共用 gridPos——转场两端
 * 的几何同源,接管才能无跳变。全部输出为视口分数(ViewportRect 约定,
 * y 自顶向下),无 DOM 依赖,可单测。
 * 使用方:scene-multiply / scene-wall / scene-finale / transitions。
 */

import type { ViewportRect } from "./gl/dom-sync";

/** 画布主角边长上限(px),与场景层的 w-[min(52vh,480px)] 保持一致 */
const SQUARE_MAX_PX = 480;
/** 画布主角边长相对视口高的比例 */
const SQUARE_VH_RATIO = 0.52;

/**
 * 画布主角规格:边长 min(0.52*vh, 480px) 的居中正方形。
 * 输入视口像素尺寸,输出视口分数矩形;零尺寸视口按 1 兜底防 NaN。
 */
export function centerSquareRect(vw: number, vh: number): ViewportRect {
  const sw = vw > 0 ? vw : 1;
  const sh = vh > 0 ? vh : 1;
  const side = Math.min(SQUARE_VH_RATIO * sh, SQUARE_MAX_PX);
  const w = side / sw;
  const h = side / sh;
  return { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h };
}

/** 4x4 满视口网格的缝宽(px),换算视口分数后参与格宽计算 */
const GRID_GAP_PX = 24;

/**
 * 4x4 满视口网格第 i 格(0-15,行优先),含 24px 缝,四边贴视口。
 * 增殖幕 DOM 网格与展墙拉开前的起始布局共用本函数。
 */
export function gridPos(i: number, vw: number, vh: number): ViewportRect {
  const sw = vw > 0 ? vw : 1;
  const sh = vh > 0 ? vh : 1;
  const gapX = GRID_GAP_PX / sw;
  const gapY = GRID_GAP_PX / sh;
  const w = (1 - 3 * gapX) / 4;
  const h = (1 - 3 * gapY) / 4;
  const col = i % 4;
  const row = Math.floor(i / 4);
  return { x: col * (w + gapX), y: row * (h + gapY), w, h };
}

/** 展墙横条:格高 52vh、格宽 0.36 视口宽、缝 0.06、奇偶垂直交错 4.5vh */
const STRIP_H = 0.52;
const STRIP_W = 0.36;
const STRIP_GAP = 0.06;
const STRIP_STAGGER = 0.045;

/**
 * 展墙横条第 i 格:自左向右等距排布,首端留一个缝宽,奇偶交错垂直偏移。
 * trackWidth 为整条轨道总宽(视口宽分数,含首尾缝),供推轨位移
 * glide * (trackWidth - 1) 归一化——glide=1 时轨道尾端贴视口右缘。
 * WHY 保留 vw/vh 形参:与 gridPos/centerSquareRect 调用形态对齐,
 * 横条几何全部以视口分数定义,当前无需像素换算。
 */
export function stripPos(
  i: number,
  count: number,
  _vw: number,
  _vh: number
): ViewportRect & { trackWidth: number } {
  const x = STRIP_GAP + i * (STRIP_W + STRIP_GAP);
  const y = 0.5 - STRIP_H / 2 + (i % 2 === 0 ? -STRIP_STAGGER : STRIP_STAGGER);
  const trackWidth = STRIP_GAP + count * (STRIP_W + STRIP_GAP);
  return { x, y, w: STRIP_W, h: STRIP_H, trackWidth };
}

/**
 * 两矩形线性插值,t 钳制到 [0,1]。
 * WHY 双侧加权式 a*(1-t)+b*t:端点处返回值与输入逐位相等
 * (a+(b-a)*t 在 t=1 有浮点残差),转场两端才能严格咬合。
 */
export function mixRect(
  a: ViewportRect,
  b: ViewportRect,
  t: number
): ViewportRect {
  const c = Math.min(1, Math.max(0, t));
  const k = 1 - c;
  return {
    x: a.x * k + b.x * c,
    y: a.y * k + b.y * c,
    w: a.w * k + b.w * c,
    h: a.h * k + b.h * c,
  };
}
