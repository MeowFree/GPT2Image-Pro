/**
 * 影片素材接收管线:把 gen-artworks.cjs 生成的 AI 水墨原图统一化后
 * 替换 public/cinema 现役资产。步骤:白点归一(16 张纸底亮度对齐,
 * 抽样 p95 映射到统一纸白,墨色随缩放仍近黑)-> hero 盖统一朱砂印
 * (sealSvg 与 paint-ink.cjs 逐字一致,全片唯一强调色不变)->
 * hero 深度图(亮度反相 + 模糊,亮近暗远,dolly 视差用)-> 导出 webp
 * (hero 2048 供微距凝视,墙作 640)。输出与现役文件同名,前端零改动。
 * 用法(在 apps/web 目录): node scripts/ingest-artworks.cjs
 * 印章位置经审阅样张确认后固化于 SEAL_POS。
 */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const SRC_DIR = path.join(__dirname, "artwork-src");
const OUT_DIR = path.join(__dirname, "..", "public", "cinema");
const PREVIEW_DIR = path.join(__dirname, "preview");
fs.mkdirSync(path.join(OUT_DIR, "wall"), { recursive: true });
fs.mkdirSync(PREVIEW_DIR, { recursive: true });

const PAPER = "#f7f3ea"; // 宣纸暖白(与 paint-ink.cjs 一致)
const SEAL_RED = "#a8352a"; // 朱砂(与 paint-ink.cjs 一致)
/** 统一纸白目标亮度(#f3 级):16 张的 p95 亮度都对齐到这里 */
const PAPER_TARGET = 242;
/** hero 印章位置与大小(图幅分数);经审阅样张确认后调整 */
const SEAL_POS = { x: 0.845, y: 0.865, size: 0.05 };

// ---------- 确定性随机与噪声(与 paint-ink.cjs 逐字一致) ----------
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash1(i, seed) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(t, seed) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i, seed) + (hash1(i + 1, seed) - hash1(i, seed)) * u;
}
function fbm(t, seed, oct = 3) {
  let v = 0;
  let amp = 0.5;
  let fr = 1;
  for (let o = 0; o < oct; o++) {
    v += amp * (vnoise(t * fr, seed + o * 101) * 2 - 1);
    amp *= 0.5;
    fr *= 2.03;
  }
  return v;
}
const r2 = (v) => Math.round(v * 100) / 100;
function poly(points) {
  if (points.length < 3) return "";
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${r2(p[0])},${r2(p[1])}`)
    .join("");
  return `${d}Z`;
}

// ---------- 印章(与 paint-ink.cjs sealSvg 逐字一致) ----------
function sealSvg(cx, cy, size, seed, opt = {}) {
  const { bar = true } = opt;
  const rnd = mulberry32(seed);
  const h = size / 2;
  const pts = [];
  const n = 36;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    const r = h * Math.min(sq, 1.32) * (1 + 0.035 * fbm(a * 3 + 2, seed));
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  let out = `<path d="${poly(pts)}" fill="${SEAL_RED}" fill-opacity="0.92"/>`;
  if (bar) {
    const bw = size * 0.6;
    const bh = size * 0.13;
    const rot = -2 + rnd() * 4;
    const bp = [];
    const m = 26;
    for (let k = 0; k <= m; k++) {
      const t = k / m;
      const bulge =
        1 +
        0.22 * Math.exp(-((t / 0.12) ** 2)) +
        0.18 * Math.exp(-(((1 - t) / 0.1) ** 2));
      bp.push({
        x: -bw / 2 + bw * t,
        w: bh * bulge * (1 + 0.1 * fbm(t * 4, seed + 3)),
      });
    }
    const top = bp.map((p) => [p.x, -p.w / 2]);
    const bot = bp.map((p) => [p.x, p.w / 2]).reverse();
    const rad = (rot * Math.PI) / 180;
    const rotp = ([x, y]) => [
      cx + x * Math.cos(rad) - y * Math.sin(rad),
      cy + x * Math.sin(rad) + y * Math.cos(rad),
    ];
    out += `<path d="${poly([...top, ...bot].map(rotp))}" fill="${PAPER}" fill-opacity="0.94"/>`;
  }
  for (let k = 0; k < 4; k++) {
    const a = rnd() * Math.PI * 2;
    out += `<circle cx="${r2(cx + h * 1.02 * Math.cos(a))}" cy="${r2(cy + h * 1.02 * Math.sin(a))}" r="${r2(1.2 + rnd() * 1.8)}" fill="${PAPER}" fill-opacity="0.85"/>`;
  }
  return out;
}

/** 抽样求亮度 p95:图缩到 256 灰度取原始像素排序(纸底代表值) */
async function paperWhiteP95(input) {
  const raw = await sharp(input)
    .resize(256, 256, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const arr = Array.from(raw).sort((a, b) => a - b);
  return arr[Math.floor(arr.length * 0.95)] || PAPER_TARGET;
}

/** 白点归一:p95 -> PAPER_TARGET 的线性缩放,钳制防个别图爆改 */
async function normalized(input) {
  const p95 = await paperWhiteP95(input);
  const scale = Math.max(0.9, Math.min(1.12, PAPER_TARGET / p95));
  return sharp(input).linear(scale, 0).png().toBuffer();
}

async function ingestHero() {
  const src = path.join(SRC_DIR, "hero.png");
  if (!fs.existsSync(src)) {
    console.log("hero.png 缺失,跳过");
    return;
  }
  const norm = await normalized(src);
  const meta = await sharp(norm).metadata();
  const W = meta.width || 2048;
  // 统一朱砂印:全片唯一强调色,阴刻「一」,种子固定可复现
  const seal = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}">${sealSvg(
      W * SEAL_POS.x,
      W * SEAL_POS.y,
      W * SEAL_POS.size,
      33
    )}</svg>`
  );
  const sealed = await sharp(norm)
    .composite([{ input: seal }])
    .png()
    .toBuffer();
  await sharp(sealed)
    .resize(2048, 2048)
    .webp({ quality: 88 })
    .toFile(path.join(OUT_DIR, "artwork-hero.webp"));
  // 深度图:亮度反相(墨深即近) + 模糊,dolly 分层视差用。
  // 先压平移除 alpha:negate 默认连 alpha 一起取反,输出会全透明
  await sharp(sealed)
    .flatten({ background: PAPER })
    .greyscale()
    .negate({ alpha: false })
    .blur(8)
    .resize(1024, 1024)
    .webp({ quality: 80 })
    .toFile(path.join(OUT_DIR, "artwork-hero-depth.webp"));
  await sharp(sealed)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(PREVIEW_DIR, "ai-hero-preview.png"));
  console.log("hero -> artwork-hero.webp (2048) + depth (1024)");
}

async function ingestWalls() {
  for (let i = 1; i <= 15; i++) {
    const id = `w${String(i).padStart(2, "0")}`;
    const src = path.join(SRC_DIR, `${id}.png`);
    if (!fs.existsSync(src)) {
      console.log(`${id}.png 缺失,跳过`);
      continue;
    }
    const norm = await normalized(src);
    await sharp(norm)
      .resize(640, 640)
      .webp({ quality: 82 })
      .toFile(path.join(OUT_DIR, "wall", `${id}.webp`));
    console.log(`${id} -> wall/${id}.webp (640)`);
  }
}

/** 审阅样张:4x4 contact sheet(与展位顺序一致,hero 在 14 位) */
async function contactSheet() {
  const order = [];
  for (let i = 1; i <= 14; i++) order.push(`wall/w${String(i).padStart(2, "0")}.webp`);
  order.push("artwork-hero.webp");
  order.push("wall/w15.webp");
  const cell = 320;
  const tiles = [];
  for (let k = 0; k < 16; k++) {
    const p = path.join(OUT_DIR, order[k]);
    if (!fs.existsSync(p)) continue;
    tiles.push({
      input: await sharp(p).resize(cell, cell).png().toBuffer(),
      left: (k % 4) * cell,
      top: Math.floor(k / 4) * cell,
    });
  }
  await sharp({
    create: {
      width: cell * 4,
      height: cell * 4,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(tiles)
    .png()
    .toFile(path.join(PREVIEW_DIR, "ai-contact-sheet.png"));
  console.log("contact sheet -> scripts/preview/ai-contact-sheet.png");
}

async function main() {
  await ingestHero();
  await ingestWalls();
  await contactSheet();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
