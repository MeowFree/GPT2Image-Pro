/**
 * 分块修复（block repair）。
 *
 * 职责：把一张图按「web 能出的小图尺寸」切成 2×2 带重叠的块，逐块交给外部「重绘回调」
 *   （实际是 gpt-image-2 img2img，重点修文字/细节），再把重绘后的块羽化融合拼回，
 *   最后按需超分到目标尺寸。单遍（不迭代）。
 *
 * 设计（职责分离，便于单测）：
 *   - 切块几何、比例 snap、羽化权重 都是纯函数（不依赖 sharp/后端/DB），单独单测。
 *   - blockRepairImage 编排：用 sharp 做缩放/切块/拼接，用注入的 repairTile 回调重绘每块，
 *     用注入的 upscale 回调（复用 Real-ESRGAN 超分）补足分辨率。后端调用与计费在 operations.ts。
 *
 * 关键约束：
 *   - 网格封顶 2×2（最多 4 块）以控成本；修复分辨率 R = min(目标, 2×块 − 重叠)。目标更大时
 *     先在 R 上分块修复、再超分到目标（见 operations.ts 组合）。
 *   - web 指定比例基本返回固定分辨率，重绘块缩回精确块尺寸即可；相邻块重叠区靠羽化融合消缝
 *     （img2img 是重绘、非像素级一致，羽化只能尽量无缝）。
 */
import sharp from "sharp";

// 重叠占块边的比例（越大越易消缝、但重绘覆盖越多）。
export const BLOCK_OVERLAP_FRACTION = 0.2;
// 网格封顶：每边最多 2 块（共 2×2=4 块）。
export const BLOCK_GRID_MAX = 2;

// web 后端各比例的「1K 块」尺寸（近似 web 指定比例时的固定返回分辨率，见 resolution.ts 预设）。
const TILE_RATIOS: ReadonlyArray<{ w: number; h: number }> = [
  { w: 1248, h: 1248 }, // 1:1
  { w: 1536, h: 1024 }, // 3:2 横
  { w: 1024, h: 1536 }, // 2:3 竖
];

/**
 * 纯函数：把任意宽高 snap 到最贴近的受支持块比例，返回该比例的块尺寸。
 *
 * 判据：比较 width/height 与各候选 w/h 的比值，取比值最接近者（对数距离，避免横竖不对称偏差）。
 */
export function snapToTileSize(
  width: number,
  height: number
): { tileW: number; tileH: number } {
  if (width <= 0 || height <= 0) {
    return { tileW: TILE_RATIOS[0]!.w, tileH: TILE_RATIOS[0]!.h };
  }
  const target = Math.log(width / height);
  let best = TILE_RATIOS[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of TILE_RATIOS) {
    const dist = Math.abs(Math.log(t.w / t.h) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return { tileW: best.w, tileH: best.h };
}

export type TilePlan = {
  /** 修复工作分辨率（在此分辨率上切块重绘）。 */
  repairW: number;
  repairH: number;
  /** 每边块数（1 或 2）。 */
  cols: number;
  rows: number;
  /** 相邻块重叠像素。 */
  overlapX: number;
  overlapY: number;
  /** 各块在 repair 画布上的位置与尺寸（重绘输入/输出均为该尺寸）。 */
  tiles: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
};

/**
 * 纯函数：给定块尺寸与目标较长边，规划 2×2 封顶的重叠切块。
 *
 * @param tileW/tileH 单块尺寸（web 该比例的固定返回分辨率）
 * @param targetLongEdge 期望最终较长边（如 2880）
 * @param overlapFraction 重叠占块边比例
 * @returns 修复分辨率 R（= min(目标, 2×块−重叠)）、块数（目标 ≤ 单块则 1×1，否则 2×2）与各块位置。
 *
 * 边界：目标 ≤ 单块较长边时用 1×1（整图一块）；否则每边 2 块。重叠 = 2×块 − R。
 */
export function planBlockRepair(
  tileW: number,
  tileH: number,
  targetLongEdge: number,
  overlapFraction: number = BLOCK_OVERLAP_FRACTION
): TilePlan {
  const tileLong = Math.max(tileW, tileH);
  const overlapX = Math.round(tileW * overlapFraction);
  const overlapY = Math.round(tileH * overlapFraction);

  // 每边 2 块能覆盖的最大分辨率（含重叠）。
  const cap2W = 2 * tileW - overlapX;
  const cap2H = 2 * tileH - overlapY;
  const cap2Long = Math.max(cap2W, cap2H);

  // 目标 ≤ 单块：整图一块重绘，无需切块与超分补足。
  if (targetLongEdge <= tileLong) {
    return {
      repairW: tileW,
      repairH: tileH,
      cols: 1,
      rows: 1,
      overlapX: 0,
      overlapY: 0,
      tiles: [{ x: 0, y: 0, w: tileW, h: tileH }],
    };
  }

  // 目标超过单块：2×2。修复分辨率 R = min(目标, 2块覆盖上限)，沿块比例缩放：
  //   - 目标 ≥ 上限：R = 上限，重叠 = 最小 20%；余下放大由外层超分补足到目标。
  //   - 目标 < 上限：R = 目标，重叠 = 2块 − R > 20%（目标越小重叠越大，保证足够重叠消缝）。
  const k = Math.min(1, targetLongEdge / cap2Long);
  const repairW = Math.max(tileW + 1, Math.min(cap2W, Math.round(cap2W * k)));
  const repairH = Math.max(tileH + 1, Math.min(cap2H, Math.round(cap2H * k)));
  // 实际重叠 = 2×块 − 修复分辨率（≥ 20%，随 R 减小而增大；块正好铺满 R）。
  const ovX = Math.max(1, 2 * tileW - repairW);
  const ovY = Math.max(1, 2 * tileH - repairH);

  const xs = [0, repairW - tileW];
  const ys = [0, repairH - tileH];
  const tiles: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const y of ys) {
    for (const x of xs) {
      tiles.push({ x, y, w: tileW, h: tileH });
    }
  }
  return {
    repairW,
    repairH,
    cols: 2,
    rows: 2,
    overlapX: ovX,
    overlapY: ovY,
    tiles,
  };
}

/**
 * 纯函数：一维羽化权重。块在某方向上,若该侧与相邻块重叠(有内边),则在重叠带内从 0→1 线性渐变,
 *   非重叠区权重恒 1。用于重叠区加权平均消缝。
 *
 * @param pos 块内像素坐标 [0, size)
 * @param size 块该方向尺寸
 * @param featherStart 起始羽化带宽（该块左/上侧与前一块重叠时 > 0，否则 0）
 * @param featherEnd 结束羽化带宽（该块右/下侧与后一块重叠时 > 0，否则 0）
 */
export function featherWeight1D(
  pos: number,
  size: number,
  featherStart: number,
  featherEnd: number
): number {
  let w = 1;
  if (featherStart > 0 && pos < featherStart) {
    w = Math.min(w, (pos + 0.5) / featherStart);
  }
  if (featherEnd > 0 && pos >= size - featherEnd) {
    w = Math.min(w, (size - pos - 0.5) / featherEnd);
  }
  return Math.max(0, Math.min(1, w));
}

/**
 * 编排：分块修复一张图。
 *
 * @param image 输入图片字节（通常是上游原图或已超分的图）
 * @param targetLongEdge 期望最终较长边
 * @param repairTile 注入的重绘回调：输入一块 PNG 字节 + 目标块宽高，返回重绘后的图片字节
 *   （实际由 operations.ts 用 gpt-image-2 img2img 实现，并负责逐块计费）
 * @param upscale 注入的超分回调：把图放大到指定宽高（复用 Real-ESRGAN），用于「超分到 R」与
 *   「R 超分到目标」。返回 PNG 字节。
 * @returns { buffer, tilesRepaired }：拼接+补足后的最终图，与实际重绘的块数（供计费加和）
 *
 * 边界：任一块重绘失败则该块回退为原块（不阻断整图）；全部失败则返回原图。整体失败上抛由
 *   调用方兜底回退。
 */
export async function blockRepairImage(
  image: Buffer,
  targetLongEdge: number,
  repairTile: (tile: Buffer, w: number, h: number) => Promise<Buffer>,
  upscale: (img: Buffer, w: number, h: number) => Promise<Buffer>
): Promise<{ buffer: Buffer; tilesRepaired: number }> {
  const meta = await sharp(image).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) return { buffer: image, tilesRepaired: 0 };

  const { tileW, tileH } = snapToTileSize(srcW, srcH);
  const plan = planBlockRepair(tileW, tileH, targetLongEdge);

  // 1. 把输入图缩/超分到修复分辨率 R（切块要求精确尺寸）。
  const work =
    srcW >= plan.repairW && srcH >= plan.repairH
      ? await sharp(image)
          .resize(plan.repairW, plan.repairH, { fit: "fill" })
          .png()
          .toBuffer()
      : await upscale(image, plan.repairW, plan.repairH);

  // 2. 逐块重绘：切出块 → repairTile → 缩回精确块尺寸。失败回退原块。
  const workRaw = await sharp(work)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const repaired: Buffer[] = [];
  let tilesRepaired = 0;
  for (const t of plan.tiles) {
    const tilePng = await sharp(work)
      .extract({ left: t.x, top: t.y, width: t.w, height: t.h })
      .png()
      .toBuffer();
    try {
      const out = await repairTile(tilePng, t.w, t.h);
      const norm = await sharp(out)
        .resize(t.w, t.h, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer();
      repaired.push(norm);
      tilesRepaired++;
    } catch {
      // 该块重绘失败：回退为原块（从 workRaw 抠出）。
      repaired.push(extractRawTile(workRaw.data, plan.repairW, t));
    }
  }

  // 3. 羽化融合拼回 R。
  const stitched = stitchTiles(plan, repaired);
  let result = await sharp(stitched, {
    raw: { width: plan.repairW, height: plan.repairH, channels: 3 },
  })
    .png()
    .toBuffer();

  // 4. 若目标较长边 > R 较长边，超分补足到目标（保持比例）。
  const rLong = Math.max(plan.repairW, plan.repairH);
  if (targetLongEdge > rLong) {
    const scale = targetLongEdge / rLong;
    result = await upscale(
      result,
      Math.round(plan.repairW * scale),
      Math.round(plan.repairH * scale)
    );
  }

  return { buffer: result, tilesRepaired };
}

/** 从整幅 raw RGB 抠出一块（HWC uint8）。 */
function extractRawTile(
  src: Buffer,
  srcW: number,
  t: { x: number; y: number; w: number; h: number }
): Buffer {
  const out = Buffer.allocUnsafe(t.w * t.h * 3);
  for (let y = 0; y < t.h; y++) {
    const srcOff = ((t.y + y) * srcW + t.x) * 3;
    src.copy(out, y * t.w * 3, srcOff, srcOff + t.w * 3);
  }
  return out;
}

/** 羽化加权融合各块（raw RGB）到 repair 画布。 */
function stitchTiles(plan: TilePlan, tiles: Buffer[]): Buffer {
  const { repairW, repairH, cols, rows, overlapX, overlapY } = plan;
  const area = repairW * repairH;
  const sum = new Float64Array(area * 3);
  const wsum = new Float64Array(area);

  for (let i = 0; i < plan.tiles.length; i++) {
    const t = plan.tiles[i]!;
    const data = tiles[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    // 有相邻块的一侧才羽化：左/上有前一块、右/下有后一块。
    const fL = col > 0 ? overlapX : 0;
    const fR = col < cols - 1 ? overlapX : 0;
    const fT = row > 0 ? overlapY : 0;
    const fB = row < rows - 1 ? overlapY : 0;
    for (let y = 0; y < t.h; y++) {
      const wy = featherWeight1D(y, t.h, fT, fB);
      if (wy <= 0) continue;
      for (let x = 0; x < t.w; x++) {
        const wx = featherWeight1D(x, t.w, fL, fR);
        const w = wx * wy;
        if (w <= 0) continue;
        const src = (y * t.w + x) * 3;
        const dst = (t.y + y) * repairW + (t.x + x);
        sum[dst * 3] = (sum[dst * 3] ?? 0) + (data[src] ?? 0) * w;
        sum[dst * 3 + 1] = (sum[dst * 3 + 1] ?? 0) + (data[src + 1] ?? 0) * w;
        sum[dst * 3 + 2] = (sum[dst * 3 + 2] ?? 0) + (data[src + 2] ?? 0) * w;
        wsum[dst] = (wsum[dst] ?? 0) + w;
      }
    }
  }

  const out = Buffer.allocUnsafe(area * 3);
  for (let i = 0; i < area; i++) {
    const w = wsum[i] || 1;
    out[i * 3] = clamp255((sum[i * 3] ?? 0) / w);
    out[i * 3 + 1] = clamp255((sum[i * 3 + 1] ?? 0) / w);
    out[i * 3 + 2] = clamp255((sum[i * 3 + 2] ?? 0) / w);
  }
  return out;
}

function clamp255(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
