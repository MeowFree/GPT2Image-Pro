/**
 * 掩码顺序外绘（masked sequential outpainting）——无缝分块修复。
 *
 * 职责：把图在目标分辨率上切成 1K 重叠块，按光栅顺序逐块用 gpt-image-2 的「带 mask 编辑」重绘：
 *   每块把与已完成邻块的重叠区用 mask 锁死（保留、不重绘），只重绘新区域，让模型「接着」邻块画。
 *   已提交像素永不改动、新区域由模型生成得与之连续 → 从构造上无缝（消除独立重绘+羽化的重影）。
 *
 * 为什么能无缝且尺寸稳：① 1K tile —— codex/api 后端尊重 1K 尺寸（2K/4K 才不尊重，见 #19175）；
 *   ② mask —— web 后端不发 mask，故必须路由到 codex/responses/标准 API（它们把 mask 发给上游，
 *   标准 images/edits 支持局部重绘）。见 operations.ts 的路由（requiresResponsesBackend）。
 *
 * 设计（职责分离，便于单测）：切块几何与每块保留区是纯函数（planOutpaintTiles / tileKeepInset），
 *   单独单测；编排 maskedOutpaintImage 用 sharp 做缩放/切块/合成，用注入的 editWithMask 回调重绘
 *   （gpt-image-2 带 mask，计费在 operations.ts）。任一块失败则保留原像素、不阻断。
 */
import sharp from "sharp";

// 单块边长：web/codex 都稳的 1K。
export const OUTPAINT_TILE = 1024;
// 相邻块步进占块边比例（1-步进=重叠比例）。步进 0.75 → 重叠 25%，给模型足够已提交上下文续画。
export const OUTPAINT_STEP_FRACTION = 0.75;

export type OutpaintTile = {
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
  row: number;
};

export type OutpaintPlan = {
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  tiles: ReadonlyArray<OutpaintTile>;
};

/** 纯函数：某方向上的块数（目标 ≤ 块边则 1；否则按步进覆盖目标所需块数）。 */
function axisCount(target: number, tile: number, step: number): number {
  if (target <= tile) return 1;
  return Math.ceil((target - tile) / step) + 1;
}

/** 纯函数：某方向上第 i 块的起点（均匀分布，首块 0、末块贴右/下边缘铺满）。 */
function axisPos(i: number, count: number, target: number, tile: number): number {
  if (count <= 1) return 0;
  return Math.round((i * (target - tile)) / (count - 1));
}

/**
 * 纯函数：在目标 (targetW,targetH) 上规划 1K 重叠切块（光栅顺序：先行后列，行内从左到右）。
 * 块尺寸取 min(块边, 目标)（目标小于块边时不放大切块）。相邻块均匀分布、末块贴边铺满。
 */
export function planOutpaintTiles(
  targetW: number,
  targetH: number,
  tile: number = OUTPAINT_TILE,
  stepFraction: number = OUTPAINT_STEP_FRACTION
): OutpaintPlan {
  const tileW = Math.min(tile, targetW);
  const tileH = Math.min(tile, targetH);
  const step = Math.max(1, Math.round(tile * stepFraction));
  const cols = axisCount(targetW, tileW, step);
  const rows = axisCount(targetH, tileH, step);
  const tiles: OutpaintTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        x: axisPos(col, cols, targetW, tileW),
        y: axisPos(row, rows, targetH, tileH),
        w: tileW,
        h: tileH,
        col,
        row,
      });
    }
  }
  return { cols, rows, tileW, tileH, tiles };
}

/**
 * 纯函数：某块与「已完成邻块」的重叠(保留)缩进——即该块左侧/上侧需锁死(keep)的像素宽/高。
 * 光栅顺序下，只有左邻(col-1)与上邻(row-1)已完成；重叠 = 邻块右/下缘越过本块起点的部分。
 *
 * @returns { left, top }：本块内 localX < left 或 localY < top 的区域为「保留区」(mask 不透明)。
 */
export function tileKeepInset(
  plan: OutpaintPlan,
  tile: OutpaintTile
): { left: number; top: number } {
  const { cols, tileW, tileH, tiles } = plan;
  let left = 0;
  let top = 0;
  if (tile.col > 0) {
    const leftNb = tiles[tile.row * cols + (tile.col - 1)]!;
    left = Math.max(0, leftNb.x + tileW - tile.x);
  }
  if (tile.row > 0) {
    const topNb = tiles[(tile.row - 1) * cols + tile.col]!;
    top = Math.max(0, topNb.y + tileH - tile.y);
  }
  // 防御：保留区不应吞掉整块(否则无新区域可画)。
  return { left: Math.min(left, tileW - 1), top: Math.min(top, tileH - 1) };
}

/** 构造某块的 mask（RGBA PNG）：保留区(localX<left||localY<top)不透明(255=保留)，其余透明(0=重绘)。 */
async function buildTileMask(
  w: number,
  h: number,
  left: number,
  top: number
): Promise<Buffer> {
  const rgba = Buffer.allocUnsafe(w * h * 4);
  for (let y = 0; y < h; y++) {
    const keepRow = y < top;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = keepRow || x < left ? 255 : 0;
    }
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * 编排：掩码顺序外绘修复。
 *
 * @param image 输入图片字节
 * @param targetW/targetH 目标尺寸（先缩到此尺寸再切块）
 * @param editWithMask 注入回调：输入(块画布 PNG, mask PNG, 宽, 高, 块序号)，返回带 mask 编辑后的块。
 *   实际由 operations.ts 用 gpt-image-2（带 mask、路由 codex/api）实现，并逐块计费。
 * @returns { buffer, tilesRepaired }：无缝拼接后的目标尺寸图，与实际重绘块数（供计费加和）
 *
 * 关键：只把 mask 透明(新生成)区写回画布，已提交(保留)像素原样不动 → 无缝。单块失败则整块保留原像素。
 */
export async function maskedOutpaintImage(
  image: Buffer,
  targetW: number,
  targetH: number,
  editWithMask: (
    tileCanvas: Buffer,
    mask: Buffer,
    w: number,
    h: number,
    index: number
  ) => Promise<Buffer>
): Promise<{ buffer: Buffer; tilesRepaired: number }> {
  const plan = planOutpaintTiles(targetW, targetH);
  // 画布：目标尺寸的整幅 raw RGB，初始为缩放后的原图。
  const canvas = await sharp(image)
    .resize(targetW, targetH, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  let tilesRepaired = 0;
  for (let i = 0; i < plan.tiles.length; i++) {
    const t = plan.tiles[i]!;
    const { left, top } = tileKeepInset(plan, t);
    // 从画布抠出本块当前状态（保留区=已提交邻块像素，其余=原图像素）。
    const tileRaw = extractTile(canvas, targetW, t);
    const tilePng = await sharp(tileRaw, {
      raw: { width: t.w, height: t.h, channels: 3 },
    })
      .png()
      .toBuffer();
    try {
      const mask = await buildTileMask(t.w, t.h, left, top);
      const edited = await editWithMask(tilePng, mask, t.w, t.h, i);
      const editedRaw = await sharp(edited)
        .resize(t.w, t.h, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer();
      // 只写回「新生成区」(localX>=left && localY>=top)，保留区(已提交像素)原样不动 → 无缝。
      writeNewRegion(canvas, targetW, t, editedRaw, left, top);
      tilesRepaired++;
    } catch {
      // 该块失败：画布保留原像素，继续下一块。
    }
  }

  const buffer = await sharp(canvas, {
    raw: { width: targetW, height: targetH, channels: 3 },
  })
    .png()
    .toBuffer();
  return { buffer, tilesRepaired };
}

/** 从整幅 raw RGB 抠出一块（HWC uint8）。 */
function extractTile(
  canvas: Buffer,
  canvasW: number,
  t: OutpaintTile
): Buffer {
  const out = Buffer.allocUnsafe(t.w * t.h * 3);
  for (let y = 0; y < t.h; y++) {
    const src = ((t.y + y) * canvasW + t.x) * 3;
    canvas.copy(out, y * t.w * 3, src, src + t.w * 3);
  }
  return out;
}

/** 把编辑后块的「新生成区」(排除左/上保留缩进)写回画布。 */
function writeNewRegion(
  canvas: Buffer,
  canvasW: number,
  t: OutpaintTile,
  edited: Buffer,
  left: number,
  top: number
): void {
  for (let y = top; y < t.h; y++) {
    const rowSrc = (y * t.w + left) * 3;
    const rowDst = ((t.y + y) * canvasW + (t.x + left)) * 3;
    const bytes = (t.w - left) * 3;
    edited.copy(canvas, rowDst, rowSrc, rowSrc + bytes);
  }
}
