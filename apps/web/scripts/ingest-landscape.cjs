/**
 * 山水素材接收:landscape.png -> public/cinema/两件资产。
 * 1) landscape-paint.webp:白点归一后的着色纹理(2048x1024,飞越时
 *    贴在地形上的"真画皮肤");
 * 2) landscape-height.webp:高度图(512x256 灰度)——亮度反相推导
 *    (墨浓=近山=高),高斯平滑去笔触阶梯,并沿中轴线开凿谷道
 *    (乘性走廊掩膜:中线高度压到 25%,两侧渐复)——相机沿谷道飞越
 *    不穿山,构图不依赖生成运气。
 * 用法:node scripts/ingest-landscape.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const SRC = path.join(__dirname, "artwork-src", "landscape.png");
const OUT = path.join(__dirname, "..", "public", "cinema");

/** 谷道掩膜:中心(u=0.5)压低到 0.25,|u-0.5|>0.35 复原 */
function valleyMask(u) {
  const d = Math.abs(u - 0.5);
  const t = Math.min(1, Math.max(0, (d - 0.08) / 0.27));
  const s = t * t * (3 - 2 * t);
  return 0.25 + 0.75 * s;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("缺少 artwork-src/landscape.png,先跑 gen-landscape.cjs");
    process.exit(1);
  }
  // 着色纹理:白点归一(1% 截断),转 webp
  const paint = sharp(SRC).flatten({ background: "#f4f1e9" });
  const stats = await paint.clone().stats();
  const dom = stats.channels[0];
  const lo = dom.min + (dom.max - dom.min) * 0.01;
  const hi = dom.min + (dom.max - dom.min) * 0.99;
  await paint
    .linear(255 / (hi - lo), -lo * (255 / (hi - lo)))
    .resize(2048, 1024, { fit: "fill" })
    .webp({ quality: 88 })
    .toFile(path.join(OUT, "landscape-paint.webp"));

  // 高度图:灰度 -> 反相(墨=高) -> 归一 -> 平滑 -> 谷道掩膜(逐像素乘)
  const W = 512;
  const H = 256;
  const { data, info } = await sharp(SRC)
    .flatten({ background: "#f4f1e9" })
    .grayscale()
    .negate({ alpha: false })
    .normalize()
    .blur(2.5)
    .resize(W, H, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const carved = Buffer.alloc(info.width * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const u = x / (info.width - 1);
      carved[y * info.width + x] = Math.round(
        data[y * info.width + x] * valleyMask(u)
      );
    }
  }
  await sharp(carved, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .webp({ quality: 92, lossless: false })
    .toFile(path.join(OUT, "landscape-height.webp"));
  console.log(
    "已输出 public/cinema/landscape-paint.webp 与 landscape-height.webp"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
