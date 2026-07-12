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
/** 观展低语专属栏位宽(视口宽分数):插在指定格之后,展品间的呼吸位 */
const STRIP_WHISPER_W = 0.16;

/**
 * 展墙横条第 i 格:自左向右等距排布,首端留一个缝宽,奇偶交错垂直偏移。
 * whisperAfter 列出插有低语栏位的格序,其后所有格顺延一个栏位宽——
 * 低语是轨道上的一站,不是塞进画缝的注脚。
 * trackWidth 为整条轨道总宽(视口宽分数,含首尾缝与低语栏位),供推轨
 * 位移 glide * (trackWidth - 1) 归一化——glide=1 时轨道尾端贴视口右缘。
 * WHY 保留 vw/vh 形参:与 gridPos/centerSquareRect 调用形态对齐,
 * 横条几何全部以视口分数定义,当前无需像素换算。
 */
export function stripPos(
  i: number,
  count: number,
  _vw: number,
  _vh: number,
  whisperAfter: readonly number[] = []
): ViewportRect & { trackWidth: number } {
  const extraBefore = whisperAfter.filter((a) => a < i).length;
  const x =
    STRIP_GAP + i * (STRIP_W + STRIP_GAP) + extraBefore * STRIP_WHISPER_W;
  const y = 0.5 - STRIP_H / 2 + (i % 2 === 0 ? -STRIP_STAGGER : STRIP_STAGGER);
  const trackWidth =
    STRIP_GAP +
    count * (STRIP_W + STRIP_GAP) +
    whisperAfter.length * STRIP_WHISPER_W;
  return { x, y, w: STRIP_W, h: STRIP_H, trackWidth };
}

/**
 * 低语栏位矩形:位于第 afterIndex 格与下一格之间,占专属栏位宽,
 * 垂直与横条中线对齐。返回 trackWidth 与 stripPos 一致,供同速推轨。
 */
export function stripWhisperSlot(
  afterIndex: number,
  count: number,
  vw: number,
  vh: number,
  whisperAfter: readonly number[]
): ViewportRect & { trackWidth: number } {
  const base = stripPos(afterIndex, count, vw, vh, whisperAfter);
  return {
    x: base.x + STRIP_W + STRIP_GAP / 2,
    y: 0.5 - STRIP_H / 2,
    w: STRIP_WHISPER_W,
    h: STRIP_H,
    trackWidth: base.trackWidth,
  };
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

/** easeInOutCubic:形制变换与入匣下沉的起收呼吸(模块私有) */
function easeInOutCubic(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u * u) / 2;
}

/**
 * frame 幕三段停拍窗口(幕内进度分数):每个形制变换完成后的驻留段,
 * 尺寸注在此窗口显影。与 frameRect 的分段节点同一事实源。
 */
export const FRAME_HOLDS: readonly { start: number; end: number }[] = [
  { start: 0.2, end: 0.34 },
  { start: 0.48, end: 0.62 },
  { start: 0.76, end: 0.86 },
] as const;

/**
 * 按宽高比适配的居中矩形:ratio = 宽/高,heightPx 为期望高,
 * 超出安全区(宽 84% / 高 72%)时保比例收缩。
 */
function ratioRect(
  ratio: number,
  heightPx: number,
  vw: number,
  vh: number
): ViewportRect {
  const sw = vw > 0 ? vw : 1;
  const sh = vh > 0 ? vh : 1;
  let hPx = heightPx;
  let wPx = heightPx * ratio;
  const maxW = sw * 0.84;
  const maxH = sh * 0.72;
  if (wPx > maxW) {
    wPx = maxW;
    hPx = wPx / ratio;
  }
  if (hPx > maxH) {
    hPx = maxH;
    wPx = hPx * ratio;
  }
  const w = wPx / sw;
  const h = hPx / sh;
  return { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h };
}

/**
 * frame 幕「形制」矩形:同一幅画的装裱形制序列——
 * 方(承接 pick 落幅)-> 横批 16:9 -> 立轴 9:16 -> 斗方大幅 -> 回方
 * (交棒 archive)。每段 easeInOut,停拍窗与 FRAME_HOLDS 对齐;
 * 端点回归 centerSquareRect(前后幕逐位咬合),全程 frameP 纯函数。
 */
export function frameRect(
  frameP: number,
  vw: number,
  vh: number
): ViewportRect {
  const sh = vh > 0 ? vh : 1;
  const square = centerSquareRect(vw, vh);
  const wide = ratioRect(16 / 9, sh * 0.4, vw, vh);
  const tall = ratioRect(9 / 16, sh * 0.68, vw, vh);
  const grand = ratioRect(1, sh * 0.66, vw, vh);
  const stops: readonly { at: number; rect: ViewportRect }[] = [
    { at: 0.06, rect: square },
    { at: FRAME_HOLDS[0]?.start ?? 0.2, rect: wide },
    { at: FRAME_HOLDS[0]?.end ?? 0.34, rect: wide },
    { at: FRAME_HOLDS[1]?.start ?? 0.48, rect: tall },
    { at: FRAME_HOLDS[1]?.end ?? 0.62, rect: tall },
    { at: FRAME_HOLDS[2]?.start ?? 0.76, rect: grand },
    { at: FRAME_HOLDS[2]?.end ?? 0.86, rect: grand },
    { at: 0.98, rect: square },
  ];
  const first = stops[0];
  if (!first || frameP <= first.at) return square;
  for (let k = 0; k < stops.length - 1; k++) {
    const a = stops[k];
    const b = stops[k + 1];
    if (!a || !b) break;
    if (frameP <= b.at) {
      const t = (frameP - a.at) / (b.at - a.at);
      return mixRect(a.rect, b.rect, easeInOutCubic(t));
    }
  }
  return square;
}

/** 画匣矩形:视口中央偏下的横匣(archive 幕的容器与画作落点事实源) */
export function archiveChestRect(vw: number, vh: number): ViewportRect {
  const sw = vw > 0 ? vw : 1;
  const sh = vh > 0 ? vh : 1;
  const wPx = Math.min(0.44 * sh, 420);
  const hPx = 0.15 * sh;
  const w = wPx / sw;
  const h = hPx / sh;
  return { x: 0.5 - w / 2, y: 0.62, w, h };
}

/**
 * archive 幕「藏」:画作自中央缩小下移到匣口,再沉入匣内。
 * 返回画作矩形与没入比例 sink(0-1,驱动匣口平面的 clip 裁切:
 * 画底先入匣,可见高度 = h * (1 - sink))。
 * 分段:[0,0.14] 停拍承接 -> [0.14,0.5] 缩小降至匣口悬停 ->
 * [0.5,0.74] 下沉没入 -> [0.74,1] 全没(匣盖/题签由场景层接管)。
 * 全程 archiveP 纯函数,倒放即画作从匣中升回。
 */
export function archiveDrop(
  archiveP: number,
  vw: number,
  vh: number
): { rect: ViewportRect; sink: number } {
  const sw = vw > 0 ? vw : 1;
  const sh = vh > 0 ? vh : 1;
  const square = centerSquareRect(vw, vh);
  const chest = archiveChestRect(vw, vh);
  const sidePx = Math.min(0.3 * sh, chest.w * sw * 0.72);
  const w = sidePx / sw;
  const h = sidePx / sh;
  // 悬停位:画底贴匣口(chest.y),水平居中
  const hover: ViewportRect = { x: 0.5 - w / 2, y: chest.y - h, w, h };
  const approach = easeInOutCubic(
    Math.min(1, Math.max(0, (archiveP - 0.14) / 0.36))
  );
  const sink = easeInOutCubic(
    Math.min(1, Math.max(0, (archiveP - 0.5) / 0.24))
  );
  const base = mixRect(square, hover, approach);
  // 下沉:矩形整体下移 sink*h,配合 clip 呈现"没入匣口平面"
  return { rect: { ...base, y: base.y + sink * h }, sink };
}
