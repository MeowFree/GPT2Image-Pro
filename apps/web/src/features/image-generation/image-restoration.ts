/**
 * 服务端图像修复（SCUNet real-GAN，1x 复原、不放大）。
 *
 * 职责：对上游返回图做「盲复原」——去噪、去压缩块、轻度去糊、增强质感，不改变分辨率。
 *   与「超分」（super-resolution.ts，把偏小图放大到目标尺寸）职责分离：
 *   典型管线是「先修复（原分辨率）再超分（放大到目标）」，修复放前面省算力。
 *   由请求级「高清修复」开关手动触发（默认关）、并受管理端主开关门控（见 operations.ts）。
 *
 * 模型来源/许可：SCUNet color real-GAN（Kai Zhang 等，
 *   https://github.com/cszn/SCUNet，Apache-2.0，可商用；Swin-Conv-UNet，config=[4]×7，
 *   dim=64，1x 盲复原）。由官方 .pth 导出为动态尺寸 ONNX（网络内部 pad 到 64 整数倍再裁回）。
 * 推理引擎：onnxruntime-node（MIT）。预/后处理：RGB[0,1]，无 offset，输出同尺寸。
 *
 * 性能与安全：SCUNet 在纯 CPU 上较重（512 约 11s、1024 约 35s，吃满多核）。为杜绝「多请求
 *   同时触发把机器打满」（曾因重模型默认开导致全站 502），这里加**全局串行闸**：进程内同一
 *   时刻只跑一个修复推理,其余排队;并对超大图设上限跳过。整图推理（不分块）以避免复原接缝。
 */
import path from "node:path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";

import { logWarn } from "@repo/shared/logger";

// 超过此较长边则跳过修复（SCUNet 整图推理成本随像素平方增长，且修复目标是上游原分辨率图，
// 本就有界）。上游图通常 ≤1254；超大图跳过而非拖垮 CPU。
const RESTORE_MAX_EDGE = 2048;

/** 模型路径：优先 env，否则 cwd/models/scunet-color-real-gan.onnx（standalone 与 dev 一致）。 */
function modelPath(): string {
  return (
    process.env.SCUNET_MODEL_PATH?.trim() ||
    path.join(process.cwd(), "models", "scunet-color-real-gan.onnx")
  );
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(modelPath());
  }
  return sessionPromise;
}

// 全局串行闸：修复推理 CPU 密集（吃满多核），进程内串行化，防并发触发把机器打满。
// 用 promise 链实现：每次修复排在上一次之后，无论上一次成功或失败都继续放行下一个。
let restoreChain: Promise<unknown> = Promise.resolve();
function withRestoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = restoreChain.then(fn, fn);
  restoreChain = run.catch(() => undefined);
  return run;
}

function clamp255(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}

/**
 * SCUNet 盲复原（1x，不改尺寸），返回 PNG 字节。
 *
 * @param image 任意图片字节
 * @returns { buffer, applied }：applied=true 表示做了修复；跳过/失败时返回原图 applied=false
 *
 * 边界：尺寸不可解析或超过 RESTORE_MAX_EDGE 时跳过；整图推理经全局串行闸排队。任何异常都
 *   回退原图、不阻断出图管线。
 */
export async function restoreImage(
  image: Buffer
): Promise<{ buffer: Buffer; applied: boolean }> {
  try {
    const meta = await sharp(image).metadata();
    const W = meta.width;
    const H = meta.height;
    if (!W || !H) return { buffer: image, applied: false };
    if (Math.max(W, H) > RESTORE_MAX_EDGE) {
      logWarn("图像修复跳过：尺寸超过上限", {
        width: W,
        height: H,
        maxEdge: RESTORE_MAX_EDGE,
      });
      return { buffer: image, applied: false };
    }

    const restored = await withRestoreLock(async () => {
      const session = await getSession();
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      if (!inputName || !outputName) {
        throw new Error("restoreImage: 模型缺少输入/输出名");
      }
      // 整图 raw RGB（HWC uint8）→ CHW float32[0,1]
      const src = await sharp(image).removeAlpha().raw().toBuffer();
      const area = W * H;
      const chw = new Float32Array(3 * area);
      for (let i = 0; i < area; i++) {
        chw[i] = (src[i * 3] ?? 0) / 255;
        chw[area + i] = (src[i * 3 + 1] ?? 0) / 255;
        chw[2 * area + i] = (src[i * 3 + 2] ?? 0) / 255;
      }
      const result = await session.run({
        [inputName]: new ort.Tensor("float32", chw, [1, 3, H, W]),
      });
      const outT = result[outputName];
      if (!outT) throw new Error("restoreImage: 模型输出缺失");
      const od = outT.data as Float32Array;
      // SCUNet 为 1x，输出尺寸与输入一致；防御性以输入尺寸回写。
      const buf = Buffer.allocUnsafe(area * 3);
      for (let i = 0; i < area; i++) {
        buf[i * 3] = clamp255((od[i] ?? 0) * 255);
        buf[i * 3 + 1] = clamp255((od[area + i] ?? 0) * 255);
        buf[i * 3 + 2] = clamp255((od[2 * area + i] ?? 0) * 255);
      }
      return sharp(buf, { raw: { width: W, height: H, channels: 3 } })
        .png()
        .toBuffer();
    });

    return { buffer: restored, applied: true };
  } catch (error) {
    logWarn("图像修复失败，回退原图", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { buffer: image, applied: false };
  }
}
