/**
 * 服务端超分辨率（Real-ESRGAN / SwinIR）。
 *
 * 职责：把偏小的图片放大 4 倍并增强细节，供"分辨率校准"在上游返回图分辨率明显不足时
 *   调用（见 resolution-calibration.ts）。支持两个模型，按请求级"高清修复"开关选择：
 *   - swinir（默认，高清修复）：SwinIR-M realSR x4，Transformer，文字/结构复原最佳，但
 *     CPU 慢约 35 倍（单张 512×512 约 57s，32 核）。
 *   - general（关闭高清修复）：Real-ESRGAN general-x4v3，轻量，快（512→2048 约 1.6s），
 *     但偏软、复原弱。
 *
 * 模型来源/许可：
 *   - realesr-general-x4v3（Real-ESRGAN，Xinntao Wang 等，
 *     https://github.com/xinntao/Real-ESRGAN，BSD-3-Clause，可商用；SRVGGNetCompact，
 *     in/out=3，feat=64，conv=32，upscale=4，prelu）。
 *   - SwinIR 003_realSR_BSRGAN_DFO_s64w8_SwinIR-M_x4_GAN（SwinIR，Liang 等，
 *     https://github.com/JingyunLiang/SwinIR，Apache-2.0，可商用；embed_dim=180，
 *     depths/heads=[6]×6，window=8，nearest+conv upsampler）。
 *   两者均由官方 .pth 导出为动态尺寸 ONNX（内部 pad 到 window 整数倍）。
 * 推理引擎：onnxruntime-node（MIT）。预/后处理按各自模型标准自写（RGB[0,1]，无 offset）。
 *
 * 性能：InferenceSession 按模型进程内缓存，避免重载。大图按 tile 分块推理以限内存峰值
 *   （4 倍放大中间张量随像素平方增长；SwinIR Transformer 激活更重，故用更小 tile）。
 */
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";

/** 模型固定放大倍数（两模型一致）。 */
export const SUPER_RESOLUTION_SCALE = 4;

/** 超分模型选择：swinir=高清修复（默认），general=快速轻量。 */
export type SuperResolutionModel = "swinir" | "general";

// 各模型：文件名、路径覆盖 env、分块边长。块间重叠 PAD 统一（消除拼接缝）。
// SwinIR 用更小 tile（128）压低 Transformer 激活内存峰值；general 轻量可用 256 提速。
const PAD = 16;
const MODEL_CONFIG: Record<
  SuperResolutionModel,
  { file: string; envKey: string; tile: number }
> = {
  swinir: { file: "swinir-realsr-x4.onnx", envKey: "SWINIR_MODEL_PATH", tile: 128 },
  general: {
    file: "realesr-general-x4v3.onnx",
    envKey: "REALESR_MODEL_PATH",
    tile: 256,
  },
};

/** 模型路径：优先对应 env，否则 cwd/models/<file>（standalone 与 dev 一致）。 */
function modelPath(model: SuperResolutionModel): string {
  const cfg = MODEL_CONFIG[model];
  return (
    process.env[cfg.envKey]?.trim() ||
    path.join(process.cwd(), "models", cfg.file)
  );
}

// 按模型缓存会话（首次用到才加载，避免未启用的模型占内存）。
const sessionPromises = new Map<
  SuperResolutionModel,
  Promise<ort.InferenceSession>
>();
function getSession(model: SuperResolutionModel): Promise<ort.InferenceSession> {
  let p = sessionPromises.get(model);
  if (!p) {
    p = ort.InferenceSession.create(modelPath(model));
    sessionPromises.set(model, p);
  }
  return p;
}

/** 对一块 padded RGB（HWC uint8）跑模型，返回 4 倍的 RGB（HWC uint8）。 */
async function runTile(
  session: ort.InferenceSession,
  hwc: Buffer,
  w: number,
  h: number
): Promise<{ data: Buffer; w: number; h: number }> {
  const area = w * h;
  const chw = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    chw[i] = (hwc[i * 3] ?? 0) / 255;
    chw[area + i] = (hwc[i * 3 + 1] ?? 0) / 255;
    chw[2 * area + i] = (hwc[i * 3 + 2] ?? 0) / 255;
  }
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    throw new Error("superResolve: 模型缺少输入/输出名");
  }
  const result = await session.run({
    [inputName]: new ort.Tensor("float32", chw, [1, 3, h, w]),
  });
  const out = result[outputName];
  if (!out) throw new Error("superResolve: 模型输出缺失");
  const dims = out.dims as number[];
  const oh = dims[2] ?? h * SUPER_RESOLUTION_SCALE;
  const ow = dims[3] ?? w * SUPER_RESOLUTION_SCALE;
  const od = out.data as Float32Array;
  const oarea = ow * oh;
  const buf = Buffer.allocUnsafe(oarea * 3);
  for (let i = 0; i < oarea; i++) {
    buf[i * 3] = clamp255((od[i] ?? 0) * 255);
    buf[i * 3 + 1] = clamp255((od[oarea + i] ?? 0) * 255);
    buf[i * 3 + 2] = clamp255((od[2 * oarea + i] ?? 0) * 255);
  }
  return { data: buf, w: ow, h: oh };
}

function clamp255(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

/**
 * 超分放大 4 倍，返回 PNG 字节。
 *
 * @param image 任意图片字节
 * @param model 模型选择：swinir（默认，高清修复）或 general（快速）
 * @returns 放大 4 倍的 PNG 字节
 * @throws 尺寸不可解析或模型输出异常时抛错
 * 副作用：CPU 密集；大图分块以限内存（tile 大小随模型不同）。
 */
export async function superResolve(
  image: Buffer,
  model: SuperResolutionModel = "swinir"
): Promise<Buffer> {
  const session = await getSession(model);
  const TILE = MODEL_CONFIG[model].tile;
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("superResolve: 无法解析图片尺寸");
  }
  const W = meta.width;
  const H = meta.height;
  const S = SUPER_RESOLUTION_SCALE;

  // 整图 raw RGB（HWC uint8），从中切块。
  const src = await sharp(image).removeAlpha().raw().toBuffer();
  const outW = W * S;
  const outH = H * S;
  const out = Buffer.allocUnsafe(outW * outH * 3);

  for (let ty = 0; ty < H; ty += TILE) {
    for (let tx = 0; tx < W; tx += TILE) {
      // 本块的有效区域（不含重叠）
      const x1 = Math.min(tx + TILE, W);
      const y1 = Math.min(ty + TILE, H);
      // 带重叠的 padded 输入区域（边界裁齐）
      const px0 = Math.max(0, tx - PAD);
      const py0 = Math.max(0, ty - PAD);
      const px1 = Math.min(W, x1 + PAD);
      const py1 = Math.min(H, y1 + PAD);
      const pw = px1 - px0;
      const ph = py1 - py0;

      // 从整图 raw 抠出 padded 块（HWC）
      const tile = Buffer.allocUnsafe(pw * ph * 3);
      for (let y = 0; y < ph; y++) {
        const srcOff = ((py0 + y) * W + px0) * 3;
        src.copy(tile, y * pw * 3, srcOff, srcOff + pw * 3);
      }

      const up = await runTile(session, tile, pw, ph);

      // 把 padded 输出里"有效区域"对应的子块写回 out 画布（裁掉重叠，消缝）
      const offX = (tx - px0) * S; // 有效区在 padded 输出里的左上角
      const offY = (ty - py0) * S;
      const validW = (x1 - tx) * S;
      const validH = (y1 - ty) * S;
      const dstX = tx * S;
      const dstY = ty * S;
      for (let y = 0; y < validH; y++) {
        const srcOff = ((offY + y) * up.w + offX) * 3;
        const dstOff = ((dstY + y) * outW + dstX) * 3;
        up.data.copy(out, dstOff, srcOff, srcOff + validW * 3);
      }
    }
  }

  return sharp(out, { raw: { width: outW, height: outH, channels: 3 } })
    .png()
    .toBuffer();
}
