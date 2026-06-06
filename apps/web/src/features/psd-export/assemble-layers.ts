/**
 * 分层 PSD 组装(进程内,ag-psd)。
 *
 * 职责:把"生成即分层"产出的多张图组装成一个分层 PSD。底图/背景层保持不透明铺满;
 * 前景元素层(模型在纯白底上单独生成)逐层单独抠白底转 alpha,再作为透明层叠上去。
 *
 * 抠图策略:元素层【主用 ISNet】(对实心主体如人物/动物抠得干净);仅当 ISNet 把某层抠到近乎全空
 * (不透明覆盖率过低,常见于稀疏/接近白的主体,如樱花树的镂空花枝——实测可被 ISNet 抠到 alpha≈3)
 * 时,该层【自动回退白底 chroma-key】,避免丢层。两者均为逐层单独处理,互不影响。
 *
 * 分层在生成阶段由 agent【正向逐层生成】完成(整图 → 背景 → 各元素),本模块只负责把现成的层
 * 堆叠为 PSD,不做图像分解、不生成新图、不扣费。注意这是"生成式分层",层间可能有尺度/位置漂移,
 * 叠加为近似还原而非像素级还原。
 *
 * 使用方:分层 generation 完成后的后台组装(见 orchestrator 的分层导出路径)。
 * 许可:ag-psd(MIT)、sharp(Apache-2.0)、ISNet(MIT,见 matte.ts)。
 */
import { writePsdBuffer } from "ag-psd";
import sharp from "sharp";
import { removeBackground } from "./matte";

/** 不透明覆盖率(alpha>200 的像素占比),用于判断 ISNet 是否把某层抠到近乎全空。 */
async function opaqueRatio(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let opaque = 0;
  const n = info.width * info.height;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 200) opaque++;
  }
  return n > 0 ? opaque / n : 0;
}

/**
 * 元素层抠白底:主用 ISNet;若结果近乎全空(<2% 不透明)则回退白键。逐层单独处理。
 */
async function matteElement(image: Buffer): Promise<Buffer> {
  const isnet = await removeBackground(image);
  if ((await opaqueRatio(isnet)) >= 0.02) {
    return isnet;
  }
  // ISNet 抠空(稀疏/接近白主体)→ 回退白键,保住该层。
  return keyOutWhite(image);
}

/** 单层规格。 */
export type LayerSpec = {
  /** 图层名(显示在 PS 图层面板)。 */
  name: string;
  /** 图层图像字节(任意可解码格式)。 */
  image: Buffer;
  /**
   * true=底层/背景层:不抠图、铺满整幅、不透明;
   * false=前景元素层:在纯白底单独生成,需抠白底转透明后叠加。
   */
  opaque: boolean;
};

export type AssembleLayeredPsdInput = {
  /** 自底向上的层序:第 0 个在最底(应为背景层,opaque=true)。 */
  layers: LayerSpec[];
  /**
   * 可选的整图(round 1 合成图),作为 PSD 的合成预览(document imageData)。
   * 不影响各图层数据;仅供不重算的查看器显示。缺省时用最底层充当预览。
   */
  composite?: Buffer;
};

/**
 * 白底 chroma-key:把"纯白背景上的单元素图"的白底抠成透明,主体(含稀疏边缘)保留。
 *
 * 按像素 min(r,g,b) 判定接近白的程度:<=LOW 全保留(不透明)、>=HIGH 当作纯白(透明)、
 * 中间线性过渡(边缘抗锯齿)。LOW 取较高值以保住浅色主体(如浅粉樱花,min≈200 仍判为不透明),
 * 只削除接近纯白的背景。与已有 alpha 取 min,兼容输入本身带 alpha 的情况。
 */
async function keyOutWhite(image: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const LOW = 235;
  const HIGH = 252;
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.min(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    const keyed =
      m <= LOW ? 255 : m >= HIGH ? 0 : Math.round((255 * (HIGH - m)) / (HIGH - LOW));
    data[i + 3] = Math.min(data[i + 3] ?? 255, keyed);
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/** sharp 解码为指定画布尺寸的非预乘 RGBA 像素。 */
async function toRgba(
  image: Buffer,
  width: number,
  height: number
): Promise<{ data: Uint8Array; width: number; height: number }> {
  // fit:"fill" 强制对齐画布尺寸——模型被要求各层同尺寸,正常无形变;兜底防个别层尺寸偏差。
  const raw = await sharp(image)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return { data: new Uint8Array(raw), width, height };
}

/**
 * 组装分层 PSD。
 *
 * 画布尺寸取第一层(背景层)的原始尺寸;其余层对齐到该尺寸。
 * ag-psd 的 children 数组顺序:索引 0 在图层面板最底层,故按 layers 原序(自底向上)传入。
 *
 * @throws 无任何层、或背景层尺寸不可解析时抛错。
 */
export async function assembleLayeredPsd(
  input: AssembleLayeredPsdInput
): Promise<Buffer> {
  const { layers } = input;
  if (layers.length === 0) {
    throw new Error("assembleLayeredPsd: 没有可组装的图层");
  }

  // 画布尺寸 = 背景层(第 0 层)尺寸。
  const base = layers[0];
  if (!base) {
    throw new Error("assembleLayeredPsd: 缺少背景层");
  }
  const meta = await sharp(base.image).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("assembleLayeredPsd: 无法解析背景层尺寸");
  }
  const width = meta.width;
  const height = meta.height;

  // 各层转 RGBA:不透明层(背景)直接铺满;元素层逐层抠白底(ISNet 为主,近空回退白键)。
  const children = await Promise.all(
    layers.map(async (layer) => {
      const src = layer.opaque ? layer.image : await matteElement(layer.image);
      const imageData = await toRgba(src, width, height);
      return {
        name: layer.name,
        top: 0,
        left: 0,
        imageData,
      };
    })
  );

  // 合成预览:优先用整图,否则退化为最底层。
  const compositeSource = input.composite ?? base.image;
  const compositeData = await toRgba(compositeSource, width, height);

  return writePsdBuffer({
    width,
    height,
    children,
    imageData: compositeData,
  });
}
