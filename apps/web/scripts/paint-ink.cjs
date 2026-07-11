/**
 * 水墨手绘引擎:确定性程序化水墨渲染(node + sharp),影片全部作品
 * 资产(public/cinema 下主角一笔圆/深度图/15 件展墙水墨)的生成器。
 * 不依赖 SVG filter:笔毫束几何全部在 JS 计算 --
 * 每根笔毫是一条沿中心线的变宽多边形带,飞白 = 笔毫按干枯度断笔,
 * 颗粒 = 墨内散点,洇痕 = 放宽几何的模糊底层,纸纹 = 程序噪声叠加。
 * 全部随机数取固定种子,同版本脚本重跑输出逐字节可复现。
 * 用法(在 apps/web 目录): node scripts/paint-ink.cjs hero|walls|all
 * 输出:资产写入 public/cinema/,审阅样张(hero 预览与 4x4 contact
 * sheet)写入 scripts/preview/。
 */
const path = require("node:path");
const sharp = require("sharp");

const OUT_DIR = path.join(__dirname, "..", "public", "cinema");
const PREVIEW_DIR = path.join(__dirname, "preview");

const S = 2048; // 渲染尺寸(2x 超采样,输出降到 1024)
const PAPER = "#f7f3ea"; // 宣纸暖白
const INK = "#221d1a"; // 墨色(暖黑)
const SEAL_RED = "#a8352a"; // 朱砂

// ---------- 确定性随机与噪声 ----------
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
// 一维平滑值噪声与分形叠加,输出约 [-1,1]
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
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (a, b, v) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- 几何工具 ----------
/** 多边形点数组 -> SVG path */
function poly(points) {
  if (points.length < 3) return "";
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${r2(p[0])},${r2(p[1])}`).join("");
  return `${d}Z`;
}
/** 不规则圆盘(墨点/起笔头),ky 为纵向压扁比 */
function blobPath(cx, cy, r, seed, wob = 0.09, n = 44, ky = 1) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (1 + wob * fbm(a * 2.3 + 7, seed));
    pts.push([cx + rr * Math.cos(a), cy + rr * ky * Math.sin(a)]);
  }
  return poly(pts);
}

// ---------- 笔道引擎 ----------
/**
 * 通用笔道:中心线由 fn(t) 提供 {x,y,nx,ny}(位置与单位法线),
 * 宽度由 wOf(t) 提供(全宽 px)。按笔毫束生成带飞白的多边形带集合。
 * 返回 { inkParts, haloParts, runs } -- runs 供撒颗粒使用。
 */
function brushStroke(fn, wOf, opt) {
  const {
    seed,
    bristles = 14,
    samples = 420,
    dryStart = 0.42, // 干枯从何处开始
    dryMax = 0.92, // 尾端最大干枯度
    edgeDry = 0.55, // 外侧笔毫更早干
    alphaBase = 0.5,
    alphaVar = 0.28,
    edgeDark = 0.1, // 咬边:外侧笔毫加深
    tailEnd = [0.86, 1.0], // 各笔毫收笔位置区间
    thRange = [0.07, 0.13], // 笔毫厚(占全宽比例)
    uSpread = 1, // 笔毫横向铺开范围
    ink = INK,
    haloAlpha = 0.12,
  } = opt;
  const rnd = mulberry32(seed);
  const inkParts = [];
  const haloParts = [];
  const runs = [];
  for (let i = 0; i < bristles; i++) {
    const u = (bristles === 1 ? 0 : (i / (bristles - 1)) * 2 - 1) * uSpread; // 横向位置
    const th0 = thRange[0] + rnd() * (thRange[1] - thRange[0]);
    const alpha = clamp01(alphaBase + (rnd() - 0.5) * 2 * alphaVar + Math.abs(u) * edgeDark);
    const tEnd = tailEnd[0] + rnd() * (tailEnd[1] - tailEnd[0]);
    const sN = seed * 7 + i * 131;
    // 分段:按干枯度决定每个采样点是否着墨
    let cur = null;
    const flush = () => {
      if (cur && cur.length >= 3) {
        const pts = [];
        const m = cur.length;
        // 段端收尖:让飞白断口呈枯丝而非平头
        const tp = (k) => Math.min(1, Math.min(k, m - 1 - k) / 3.5 + 0.15);
        for (let k = 0; k < m; k++) {
          const c = cur[k];
          pts.push([c.x + c.nx * (c.off + (c.th / 2) * tp(k)), c.y + c.ny * (c.off + (c.th / 2) * tp(k))]);
        }
        for (let k = m - 1; k >= 0; k--) {
          const c = cur[k];
          pts.push([c.x + c.nx * (c.off - (c.th / 2) * tp(k)), c.y + c.ny * (c.off - (c.th / 2) * tp(k))]);
        }
        inkParts.push(`<path d="${poly(pts)}" fill="${ink}" fill-opacity="${r2(alpha)}"/>`);
        runs.push(cur);
        // 洇痕层:同一带,放宽
        if (haloAlpha > 0) {
          const hp = [];
          for (let k = 0; k < m; k++) {
            const c = cur[k];
            hp.push([c.x + c.nx * (c.off + c.th * 1.35), c.y + c.ny * (c.off + c.th * 1.35)]);
          }
          for (let k = m - 1; k >= 0; k--) {
            const c = cur[k];
            hp.push([c.x + c.nx * (c.off - c.th * 1.35), c.y + c.ny * (c.off - c.th * 1.35)]);
          }
          haloParts.push(`<path d="${poly(hp)}" fill="#6b6257" fill-opacity="${r2(haloAlpha)}"/>`);
        }
      }
      cur = null;
    };
    for (let k = 0; k <= samples; k++) {
      const t = k / samples;
      if (t > tEnd) break;
      const w = wOf(t);
      if (w <= 0.2) {
        flush();
        continue;
      }
      const dry = sstep(dryStart, 0.98, t) * dryMax;
      const tau = dry * (0.42 + edgeDry * Math.abs(u) ** 1.2);
      // 低频决定飞白:枯丝要长,不要碎点
      const inkAmt = fbm(t * 7.5 + i * 37.1, sN) * 0.5 + 0.5;
      // micro 断笔只作用于细笔毫:宽板带断开会形成横缝假象
      const micro = th0 < 0.2 && fbm(t * 55 + i * 11.3, sN + 5) < -0.62 && Math.abs(u) > 0.72;
      if (inkAmt <= tau || micro) {
        flush();
        continue;
      }
      const p = fn(t);
      const th = th0 * w;
      const wobble = 0.03 * w * fbm(t * 6.3 + i * 3.7, sN + 9);
      const off = u * ((w - th) / 2) + wobble;
      if (!cur) cur = [];
      cur.push({ x: p.x, y: p.y, nx: p.nx, ny: p.ny, off, th });
    }
    flush();
  }
  return { inkParts, haloParts, runs };
}

/** 沿笔势拉长的墨团(起笔头):在切线/法线基底下变形的不规则圆 */
function elongBlob(fn, t0, len, wid, seed, fill = INK, alpha = 0.85) {
  const p = fn(t0);
  const q = fn(t0 + 0.01);
  let tx = q.x - p.x;
  let ty = q.y - p.y;
  const L = Math.hypot(tx, ty) || 1;
  tx /= L;
  ty /= L;
  const pts = [];
  const n = 48;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const j = 1 + 0.1 * fbm(a * 2.1 + 3, seed);
    const lx = Math.cos(a) * len * j;
    const ly = Math.sin(a) * wid * j;
    pts.push([p.x + tx * lx + p.nx * ly, p.y + ty * lx + p.ny * ly]);
  }
  return `<path d="${poly(pts)}" fill="${fill}" fill-opacity="${r2(alpha)}"/>`;
}

/** 在笔道的已着墨段内撒颗粒(墨的絮状沉淀 + 纸底针孔) */
function granulate(runs, seed, count) {
  const rnd = mulberry32(seed);
  const parts = [];
  const total = runs.reduce((s, r) => s + r.length, 0);
  if (!total) return parts;
  for (let n = 0; n < count; n++) {
    let pick = rnd() * total;
    let run = runs[0];
    for (const r of runs) {
      if (pick < r.length) {
        run = r;
        break;
      }
      pick -= r.length;
    }
    const c = run[Math.floor(rnd() * run.length)];
    const j = (rnd() - 0.5) * c.th * 0.9;
    const x = c.x + c.nx * (c.off + j);
    const y = c.y + c.ny * (c.off + j);
    const pin = rnd() < 0.12;
    const r = pin ? 0.5 + rnd() * 0.8 : 0.5 + rnd() * 1.0;
    const fill = pin ? PAPER : "#141110";
    const a = pin ? 0.2 + rnd() * 0.2 : 0.18 + rnd() * 0.28;
    parts.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}" fill="${fill}" fill-opacity="${r2(a)}"/>`);
  }
  return parts;
}

// ---------- 印章 ----------
function sealSvg(cx, cy, size, seed, opt = {}) {
  const { bar = true } = opt;
  const rnd = mulberry32(seed);
  const h = size / 2;
  // 外框:边缘轻微抖动的圆角方
  const pts = [];
  const n = 36;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    // 方形极径 + 圆角混合
    const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    const r = h * Math.min(sq, 1.32) * (1 + 0.035 * fbm(a * 3 + 2, seed));
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  let out = `<path d="${poly(pts)}" fill="${SEAL_RED}" fill-opacity="0.92"/>`;
  if (bar) {
    // 阴刻「一」:纸色横杠,端部略鼓,微倾
    const bw = size * 0.6;
    const bh = size * 0.13;
    const rot = -2 + rnd() * 4;
    const bp = [];
    const m = 26;
    for (let k = 0; k <= m; k++) {
      const t = k / m;
      const bulge = 1 + 0.22 * Math.exp(-((t / 0.12) ** 2)) + 0.18 * Math.exp(-(((1 - t) / 0.1) ** 2));
      bp.push({ x: -bw / 2 + bw * t, w: bh * bulge * (1 + 0.1 * fbm(t * 4, seed + 3)) });
    }
    const top = bp.map((p) => [p.x, -p.w / 2]);
    const bot = bp.map((p) => [p.x, p.w / 2]).reverse();
    const rad = (rot * Math.PI) / 180;
    const rotp = ([x, y]) => [cx + x * Math.cos(rad) - y * Math.sin(rad), cy + x * Math.sin(rad) + y * Math.cos(rad)];
    out += `<path d="${poly([...top, ...bot].map(rotp))}" fill="${PAPER}" fill-opacity="0.94"/>`;
  }
  // 边缘缺口(旧印泥不匀)
  for (let k = 0; k < 4; k++) {
    const a = rnd() * Math.PI * 2;
    out += `<circle cx="${r2(cx + h * 1.02 * Math.cos(a))}" cy="${r2(cy + h * 1.02 * Math.sin(a))}" r="${r2(1.2 + rnd() * 1.8)}" fill="${PAPER}" fill-opacity="0.85"/>`;
  }
  return out;
}

// ---------- 纸张与合成 ----------
function svgDoc(parts, bg) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${bg ? `<rect width="${S}" height="${S}" fill="${bg}"/>` : ""}${parts.join("")}</svg>`
  );
}
async function raster(parts, bg) {
  return sharp(svgDoc(parts, bg)).png().toBuffer();
}
/** 程序纸纹:细纤维 + 横向纤维,soft-light 叠加 */
async function fiberPng(seed) {
  const rnd = mulberry32(seed);
  const fine = Buffer.alloc(S * S);
  for (let i = 0; i < fine.length; i++) fine[i] = 96 + Math.floor(rnd() * 64);
  const fineBuf = await sharp(fine, { raw: { width: S, height: S, channels: 1 } })
    .blur(0.4)
    .png()
    .toBuffer();
  const W = 160;
  const hstr = Buffer.alloc(W * S);
  for (let i = 0; i < hstr.length; i++) hstr[i] = 96 + Math.floor(rnd() * 64);
  const hBuf = await sharp(hstr, { raw: { width: W, height: S, channels: 1 } })
    .resize(S, S, { kernel: "cubic" })
    .png()
    .toBuffer();
  return sharp(fineBuf)
    .composite([{ input: hBuf, blend: "overlay" }])
    .linear(0.4, 77) // 压向中灰,弱化强度
    .png()
    .toBuffer();
}
function vignetteSvg() {
  return svgDoc([
    `<defs><radialGradient id="v" cx="50%" cy="47%" r="72%"><stop offset="58%" stop-color="#5b5548" stop-opacity="0"/><stop offset="100%" stop-color="#5b5548" stop-opacity="0.14"/></radialGradient></defs><rect width="${S}" height="${S}" fill="url(#v)"/>`,
  ]);
}
/** 通用合成:纸 -> 洇痕(模糊) -> 淡墨晕 -> 湿区 -> 软墨(起笔头) -> 墨 -> 印 -> 纸纹 -> 晕影 */
async function composeArtwork({ haloParts, washParts, wetParts, softParts, inkParts, sealParts, outName, previewName, size = 1024 }) {
  const paper = await raster([], PAPER);
  const layers = [];
  if (haloParts?.length) layers.push({ input: await sharp(await raster(haloParts)).blur(7).png().toBuffer() });
  if (washParts?.length) layers.push({ input: await sharp(await raster(washParts)).blur(16).png().toBuffer() });
  if (wetParts?.length) layers.push({ input: await sharp(await raster(wetParts)).blur(5).png().toBuffer() });
  if (softParts?.length) layers.push({ input: await sharp(await raster(softParts)).blur(2.4).png().toBuffer() });
  layers.push({ input: await sharp(await raster(inkParts)).blur(0.6).png().toBuffer() });
  if (sealParts?.length) layers.push({ input: await sharp(await raster(sealParts)).blur(0.5).png().toBuffer() });
  layers.push({ input: await fiberPng(88), blend: "soft-light" });
  layers.push({ input: vignetteSvg() });
  const flat = await sharp(paper).composite(layers).png().toBuffer();
  await sharp(flat).resize(size, size).webp({ quality: 90 }).toFile(path.join(OUT_DIR, outName));
  if (previewName) await sharp(flat).resize(size, size).png().toFile(path.join(PREVIEW_DIR, previewName));
}

// ---------- 主角:一笔圆(枯笔圆相) ----------
function ensoCenterline() {
  const cx = S * 0.5;
  const cy = S * 0.485;
  const R0 = S * 0.315;
  const ky = 0.962; // 轻微椭圆
  const phi = (-7 * Math.PI) / 180; // 整体微倾
  const th0 = Math.PI * 0.62; // 起笔:左下
  const sweep = Math.PI * 1.86; // 收笔:下方偏右,底部留缺口
  return (t) => {
    const a = th0 + sweep * t;
    const R = R0 * (1 + 0.016 * fbm(t * 3.1, 41));
    const ex = R * Math.cos(a);
    const ey = R * ky * Math.sin(a);
    const x = cx + ex * Math.cos(phi) - ey * Math.sin(phi);
    const y = cy + ex * Math.sin(phi) + ey * Math.cos(phi);
    // 法线取径向(圆笔道)
    let nx = ex * Math.cos(phi) - ey * Math.sin(phi);
    let ny = ex * Math.sin(phi) + ey * Math.cos(phi);
    const L = Math.hypot(nx, ny) || 1;
    nx /= L;
    ny /= L;
    return { x, y, nx, ny };
  };
}
function ensoWidth() {
  const wBase = S * 0.058;
  return (t) => {
    const head = 1 + 0.8 * Math.exp(-((t / 0.05) ** 2));
    const wobble = 0.8 + 0.16 * fbm(t * 2.6, 17) + 0.06 * fbm(t * 9.1, 23);
    const tail = 1 - sstep(0.7, 1.0, t) * 0.62;
    const tip = 1 - sstep(0.965, 1.0, t) * 0.7;
    return Math.max(0, wBase * head * wobble * tail * tip);
  };
}

async function hero() {
  const fn = ensoCenterline();
  const wOf = ensoWidth();
  // 五层笔毫结构:铺底水层 -> 浓墨补笔 -> 细毫纹理 -> 咬边 -> 收锋枯丝
  const wash = brushStroke(fn, wOf, {
    seed: 7,
    bristles: 5,
    samples: 480,
    thRange: [0.42, 0.6],
    uSpread: 0.55,
    alphaBase: 0.22,
    alphaVar: 0.05,
    dryStart: 0.6,
    dryMax: 0.82,
    edgeDry: 0.3,
    edgeDark: 0,
    tailEnd: [0.85, 0.97],
    haloAlpha: 0.09,
  });
  // 浓淡呼吸:仅在若干压笔窗口内着浓墨,软边由宽度包络自然收
  const toneEnv = (t) => {
    const bump = (c, w) => Math.exp(-(((t - c) / w) ** 2));
    return Math.max(bump(0.14, 0.11), bump(0.36, 0.07) * 0.75, bump(0.56, 0.09) * 0.85);
  };
  const tone = brushStroke(fn, (t) => wOf(t) * (toneEnv(t) > 0.25 ? 0.92 : 0), {
    seed: 101,
    bristles: 3,
    samples: 480,
    thRange: [0.5, 0.68],
    uSpread: 0.3,
    alphaBase: 0.13,
    alphaVar: 0.04,
    dryStart: 0.75,
    dryMax: 0.5,
    edgeDry: 0.3,
    edgeDark: 0,
    tailEnd: [0.9, 1.0],
    haloAlpha: 0,
  });
  const texture = brushStroke(fn, wOf, {
    seed: 19,
    bristles: 10,
    samples: 480,
    thRange: [0.06, 0.11],
    uSpread: 1,
    alphaBase: 0.28,
    alphaVar: 0.14,
    dryStart: 0.5,
    dryMax: 0.9,
    edgeDry: 0.55,
    edgeDark: 0.1,
    tailEnd: [0.86, 1.0],
    haloAlpha: 0,
  });
  const edges = brushStroke(fn, wOf, {
    seed: 47,
    bristles: 2,
    samples: 480,
    thRange: [0.04, 0.055],
    uSpread: 0.9,
    alphaBase: 0.4,
    alphaVar: 0.08,
    dryStart: 0.5,
    dryMax: 0.97,
    edgeDry: 0.25,
    edgeDark: 0,
    tailEnd: [0.72, 0.92],
    haloAlpha: 0,
  });
  const hairs = brushStroke(fn, wOf, {
    seed: 61,
    bristles: 5,
    samples: 480,
    thRange: [0.02, 0.04],
    uSpread: 0.5,
    alphaBase: 0.5,
    alphaVar: 0.1,
    dryStart: 0.55,
    dryMax: 0.86,
    edgeDry: 0.3,
    edgeDark: 0,
    tailEnd: [0.93, 1.0],
    haloAlpha: 0,
  });
  // 湿区强化:前 15% 再铺一层水墨(起笔更饱满)
  const wetZone = brushStroke(fn, (t) => (t < 0.16 ? wOf(t) * 1.05 : 0), {
    seed: 83,
    bristles: 3,
    samples: 480,
    thRange: [0.4, 0.55],
    uSpread: 0.35,
    alphaBase: 0.15,
    alphaVar: 0.04,
    dryStart: 0.95,
    dryMax: 0.2,
    edgeDry: 0.2,
    edgeDark: 0,
    tailEnd: [1.0, 1.0],
    haloAlpha: 0.07,
  });
  // 起笔头:沿笔势拉长的湿重墨团,软边压在笔道之下
  const w0 = wOf(0.01);
  const headParts = [
    elongBlob(fn, 0.012, w0 * 0.82, w0 * 0.52, 91, INK, 0.72),
    elongBlob(fn, 0.02, w0 * 0.48, w0 * 0.32, 92, "#171310", 0.3),
  ];
  // 一滴溅出的小墨点(呼应开场墨滴)
  const p0 = fn(0.004);
  const drop = `<path d="${blobPath(p0.x - w0 * 1.05, p0.y + w0 * 0.8, w0 * 0.075, 93, 0.16)}" fill="${INK}" fill-opacity="0.7"/>`;
  const allRuns = [...wash.runs, ...tone.runs, ...texture.runs, ...edges.runs, ...hairs.runs];
  const speckle = granulate(allRuns, 55, 2200);
  const wetParts = [elongBlob(fn, 0.014, w0 * 1.2, w0 * 0.8, 94, "#3a352e", 0.14)];
  const seal = sealSvg(S * 0.163, S * 0.845, S * 0.052, 33);
  const stroke = {
    haloParts: [...wash.haloParts, ...wetZone.haloParts],
    inkParts: [
      ...wash.inkParts,
      ...wetZone.inkParts,
      ...tone.inkParts,
      ...texture.inkParts,
      ...edges.inkParts,
      ...hairs.inkParts,
    ],
    runs: allRuns,
  };
  await composeArtwork({
    haloParts: stroke.haloParts,
    wetParts,
    softParts: headParts,
    inkParts: [...stroke.inkParts, drop, ...speckle],
    sealParts: [seal],
    outName: "artwork-hero.webp",
    previewName: "hero-preview.png",
  });
  // 深度图:笔画近(亮),纸远(暗),起笔头最近
  const depthInk = stroke.runs.map((run) => {
    const pts = [];
    const m = run.length;
    for (let k = 0; k < m; k++) {
      const c = run[k];
      pts.push([c.x + c.nx * (c.off + c.th * 0.9), c.y + c.ny * (c.off + c.th * 0.9)]);
    }
    for (let k = m - 1; k >= 0; k--) {
      const c = run[k];
      pts.push([c.x + c.nx * (c.off - c.th * 0.9), c.y + c.ny * (c.off - c.th * 0.9)]);
    }
    return `<path d="${poly(pts)}" fill="#e9e9e9" fill-opacity="0.5"/>`;
  });
  depthInk.push(`<path d="${blobPath(p0.x, p0.y, w0 * 0.8, 91)}" fill="#ffffff" fill-opacity="0.9"/>`);
  const depthBase = svgDoc([
    `<defs><radialGradient id="d" cx="50%" cy="48%" r="70%"><stop offset="0%" stop-color="#4a4a4a"/><stop offset="100%" stop-color="#2e2e2e"/></radialGradient></defs><rect width="${S}" height="${S}" fill="url(#d)"/>`,
  ]);
  const depthFlat = await sharp(depthBase)
    .composite([{ input: await sharp(await raster(depthInk)).blur(14).png().toBuffer() }])
    .png()
    .toBuffer();
  await sharp(depthFlat).blur(4).resize(1024, 1024).grayscale().webp({ quality: 80 }).toFile(path.join(OUT_DIR, "artwork-hero-depth.webp"));
  await sharp(depthFlat).blur(4).resize(1024, 1024).grayscale().png().toFile(path.join(PREVIEW_DIR, "hero-depth-preview.png"));
  console.log("hero + depth done");
}

// ---------- 展墙题材库 ----------
const fs = require("node:fs");
const U = S / 100; // 百分比坐标单位

/** 二次贝塞尔中心线:a/b 为端点(px),bow 为中点垂向偏移(px) */
function strokePath(a, b, bow) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const m = [mx + (-dy / L) * bow, my + (dx / L) * bow];
  return (t) => {
    const u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * m[0] + t * t * b[0];
    const y = u * u * a[1] + 2 * u * t * m[1] + t * t * b[1];
    let tx = 2 * u * (m[0] - a[0]) + 2 * t * (b[0] - m[0]);
    let ty = 2 * u * (m[1] - a[1]) + 2 * t * (b[1] - m[1]);
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    return { x, y, nx: -ty, ny: tx };
  };
}
/** Catmull-Rom 多点中心线(px 坐标),切线数值微分 */
function catmullFn(pts) {
  const n = pts.length;
  const cr = (a, b, c, d, u) =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3);
  const at = (t) => {
    const ft = Math.min(0.99999, Math.max(0, t)) * (n - 1);
    const i = Math.floor(ft);
    const u = ft - i;
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[Math.min(n - 1, i + 1)];
    const p3 = pts[Math.min(n - 1, i + 2)];
    return [cr(p0[0], p1[0], p2[0], p3[0], u), cr(p0[1], p1[1], p2[1], p3[1], u)];
  };
  return (t) => {
    const p = at(t);
    const q = at(Math.min(1, t + 0.004));
    const o = at(Math.max(0, t - 0.004));
    let tx = q[0] - o[0];
    let ty = q[1] - o[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    return { x: p[0], y: p[1], nx: -ty, ny: tx };
  };
}
function newArt() {
  return { halo: [], wash: [], soft: [], ink: [], runs: [] };
}
/** 由笔形参数构造宽度函数:w0/w1 起终宽(U),press 起笔压重,tipEnd/tipBoth 收尖 */
function mkWOf(o, seed) {
  const w0 = o.w0 * U;
  const w1 = (o.w1 ?? o.w0) * U;
  return (t) => {
    let w = w0 + (w1 - w0) * t;
    if (o.press) w *= 1 + o.press * Math.exp(-((t / 0.09) ** 2));
    w *= 1 + (o.wob ?? 0.15) * fbm(t * 3.5, seed + 77);
    if (o.tipBoth) w *= sstep(0, 0.07, t);
    if (o.tipEnd || o.tipBoth) w *= 1 - sstep(0.78, 1, t) * 0.97;
    return Math.max(0, w);
  };
}
/** 通用落笔:把 brushStroke 输出并入画面收集器 */
function addBrush(art, fn, o) {
  const s = brushStroke(fn, mkWOf(o, o.seed), {
    seed: o.seed,
    bristles: o.bristles ?? 5,
    samples: o.samples ?? 160,
    thRange: o.thRange ?? [0.18, 0.3],
    uSpread: o.uSpread ?? 1,
    alphaBase: o.alpha ?? 0.4,
    alphaVar: o.alphaVar ?? 0.12,
    dryStart: o.dryStart ?? 0.55,
    dryMax: o.dryMax ?? 0.8,
    edgeDry: o.edgeDry ?? 0.4,
    edgeDark: o.edgeDark ?? 0.05,
    tailEnd: o.tailEnd ?? [0.92, 1.0],
    haloAlpha: o.haloAlpha ?? 0.05,
    ink: o.ink ?? INK,
  });
  art.ink.push(...s.inkParts);
  art.halo.push(...s.haloParts);
  art.runs.push(...s.runs);
}
/** 两点笔(U 坐标) */
function st(art, a, b, o) {
  addBrush(art, strokePath([a[0] * U, a[1] * U], [b[0] * U, b[1] * U], (o.bow ?? 0) * U), o);
}
/** 多点曲线笔(U 坐标) */
function cv(art, pts, o) {
  addBrush(art, catmullFn(pts.map((p) => [p[0] * U, p[1] * U])), o);
}
/** 淡墨晕块(进大模糊晕层,边缘如洇) */
function wash(art, cx, cy, r, alpha, seed, ky = 1) {
  art.wash.push(`<path d="${blobPath(cx * U, cy * U, r * U, seed, 0.1, 44, ky)}" fill="${INK}" fill-opacity="${r2(alpha)}"/>`);
}
/** 墨点 */
function dot(art, cx, cy, r, alpha, seed) {
  art.ink.push(`<path d="${blobPath(cx * U, cy * U, r * U, seed, 0.14)}" fill="${INK}" fill-opacity="${r2(alpha)}"/>`);
}
/** 山形剪影:底边 baseY,峰高 h,半宽 halfW;soft 时进晕层 */
function ridge(art, cx, baseY, halfW, h, alpha, seed, soft = false) {
  const pts = [];
  const n = 60;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * 2 - 1; // -1..1
    const y = baseY * U - h * U * Math.max(0, 1 - Math.abs(t) ** 1.45) * (1 + 0.22 * fbm(t * 2.8, seed));
    pts.push([cx * U + t * halfW * U, y]);
  }
  pts.push([cx * U + halfW * U, baseY * U + 2]);
  pts.push([cx * U - halfW * U, baseY * U + 2]);
  const p = `<path d="${poly(pts)}" fill="${INK}" fill-opacity="${r2(alpha)}"/>`;
  (soft ? art.wash : art.ink).push(p);
}

// 15 个题材:同一材质系统,不同意象。构图各异以造墙面节奏。
function w01_bamboo(art) {
  // 双竿:分节留白,叶三簇
  const segs = [
    [[30, 88], [31.5, 66]],
    [[31.7, 64], [33, 42]],
    [[33.2, 40], [34.5, 18]],
  ];
  for (const [a, b] of segs) st(art, a, b, { seed: 11 + a[1], w0: 2.4, w1: 2.1, bow: 0.8, alpha: 0.5, dryStart: 0.4, dryMax: 0.7 });
  for (const y of [65, 41]) st(art, [30.2, y], [34.6, y - 0.6], { seed: 7 + y, w0: 0.8, w1: 0.3, alpha: 0.62, tipEnd: true });
  const segs2 = [
    [[44, 95], [42.8, 72]],
    [[42.6, 70], [41.5, 48]],
    [[41.3, 46], [40.5, 27]],
  ];
  for (const [a, b] of segs2) st(art, a, b, { seed: 23 + a[1], w0: 1.6, w1: 1.4, bow: -0.6, alpha: 0.3, dryStart: 0.5 });
  const leaf = (o, ang, len, sd, al = 0.55) =>
    st(art, o, [o[0] + len * Math.cos(ang), o[1] + len * Math.sin(ang)], { seed: sd, w0: 1.7, w1: 0.05, bow: 1.2, alpha: al, tipEnd: true, dryStart: 0.7, bristles: 4 });
  leaf([35, 33], 0.35, 15, 31);
  leaf([35, 33], 0.75, 12, 32);
  leaf([35, 33], -0.1, 13, 33, 0.45);
  leaf([42, 47], 2.6, 13, 34);
  leaf([42, 47], 2.2, 11, 35, 0.42);
  leaf([42, 47], 2.95, 10, 36);
  leaf([29, 55], 0.55, 12, 37, 0.4);
  leaf([29, 55], 0.95, 9, 38, 0.5);
}
function w02_peaks(art) {
  ridge(art, 52, 50, 46, 14, 0.13, 71, true);
  ridge(art, 31, 58, 30, 18, 0.22, 72, true);
  ridge(art, 63, 68, 34, 23, 0.34, 73);
  // 近山脊线与皴笔:沿剪影顶部走笔,枯而断
  cv(art, [[33, 66], [48, 53], [63, 45.8], [76, 54], [92, 66]], { seed: 74, w0: 1.0, w1: 0.25, alpha: 0.52, dryStart: 0.35, dryMax: 0.92, tipEnd: true, bristles: 4 });
  cv(art, [[52, 55], [60, 51], [68, 53.5], [76, 60]], { seed: 75, w0: 0.6, w1: 0.1, alpha: 0.32, dryStart: 0.25, dryMax: 0.94, tipEnd: true, bristles: 3 });
  cv(art, [[42, 62], [50, 58.5], [56, 60], [62, 65]], { seed: 76, w0: 0.5, w1: 0.1, alpha: 0.26, dryStart: 0.25, dryMax: 0.94, tipEnd: true, bristles: 2 });
}
function w03_boat(art) {
  st(art, [16, 63.6], [80, 63], { seed: 81, w0: 0.5, w1: 0.3, alpha: 0.2, dryStart: 0.15, dryMax: 0.92, bristles: 3 });
  st(art, [24, 67.6], [62, 67.2], { seed: 82, w0: 0.4, w1: 0.25, alpha: 0.13, dryStart: 0.2, dryMax: 0.94, bristles: 2 });
  st(art, [42, 59.8], [68, 59.5], { seed: 83, w0: 0.35, w1: 0.2, alpha: 0.11, dryStart: 0.2, dryMax: 0.95, bristles: 2 });
  st(art, [42, 61.5], [57, 61], { seed: 84, w0: 1.9, bow: 1.4, alpha: 0.68, tipBoth: true, dryStart: 0.9, bristles: 6 });
  st(art, [48.6, 60.8], [49.1, 56.4], { seed: 85, w0: 0.75, w1: 0.3, alpha: 0.7, tipEnd: true, bristles: 2 });
  dot(art, 49.1, 55.8, 0.55, 0.75, 86);
  wash(art, 70, 25, 6.5, 0.12, 87);
  wash(art, 70, 25, 6.9, 0.05, 88);
}
function w04_plum(art) {
  cv(art, [[15, 80], [33, 65], [51, 59], [66, 46]], { seed: 91, w0: 1.7, w1: 0.6, alpha: 0.55, dryStart: 0.45, dryMax: 0.88 });
  st(art, [51, 59], [61, 65.5], { seed: 92, w0: 0.6, w1: 0.12, alpha: 0.5, tipEnd: true });
  st(art, [58, 52.5], [54, 44], { seed: 93, w0: 0.5, w1: 0.1, alpha: 0.48, tipEnd: true });
  // 梅花:紧贴枝端,五瓣略实,墨蕊
  const bloom = (cx, cy, sd, sc = 1) => {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + sd * 0.7;
      art.ink.push(
        `<path d="${blobPath((cx + Math.cos(a) * 0.72 * sc) * U, (cy + Math.sin(a) * 0.72 * sc) * U, 0.62 * sc * U, sd * 7 + k, 0.12)}" fill="${SEAL_RED}" fill-opacity="0.3"/>`
      );
    }
    for (let k = 0; k < 4; k++) {
      const a = k * 1.6 + sd;
      dot(art, cx + Math.cos(a) * 0.42 * sc, cy + Math.sin(a) * 0.42 * sc, 0.13 * sc, 0.72, sd * 9 + k);
    }
  };
  bloom(66.5, 45, 1);
  bloom(62.5, 48.5, 2, 0.85);
  bloom(54, 43.5, 3, 0.8);
  bloom(60.5, 65.5, 4, 0.75);
  bloom(56.5, 55.5, 6, 0.6);
  // 苞:未开的小红点
  for (const [bx, by, sd] of [[68.5, 42.5, 11], [52, 41, 12], [62.5, 62, 13]])
    art.ink.push(`<path d="${blobPath(bx * U, by * U, 0.34 * U, sd, 0.15)}" fill="${SEAL_RED}" fill-opacity="0.4"/>`);
}
function w05_moon(art) {
  wash(art, 58, 32, 13.5, 0.085, 101);
  wash(art, 58, 32, 14.2, 0.04, 102);
  // 云带横过月下缘
  st(art, [30, 37.5], [82, 39.5], { seed: 103, w0: 2.6, w1: 0.4, bow: -1.4, alpha: 0.15, dryStart: 0.25, dryMax: 0.93, tipEnd: true, bristles: 7 });
  st(art, [38, 41.5], [72, 42.5], { seed: 106, w0: 1.2, w1: 0.2, bow: -0.8, alpha: 0.1, dryStart: 0.2, dryMax: 0.95, tipEnd: true, bristles: 4 });
  st(art, [29, 58], [32.5, 57.2], { seed: 104, w0: 0.7, w1: 0.08, bow: 1, alpha: 0.55, tipEnd: true, bristles: 2 });
  st(art, [32.5, 57.2], [36, 58.2], { seed: 105, w0: 0.6, w1: 0.06, bow: -1, alpha: 0.55, tipEnd: true, bristles: 2 });
}
function w06_reeds(art) {
  const reed = (x0, top, bowr, sd, al) => {
    cv(art, [[x0, 90], [x0 + bowr * 0.35, 90 - (90 - top) * 0.5], [x0 + bowr, top]], { seed: sd, w0: 1.1, w1: 0.22, alpha: al, tipEnd: true, bristles: 3, dryStart: 0.6 });
    for (let k = 0; k < 4; k++)
      st(art, [x0 + bowr, top], [x0 + bowr + 2.4 + k * 1.2, top + 1.4 + k * 1.5], { seed: sd * 3 + k, w0: 0.5, w1: 0.04, alpha: 0.55, tipEnd: true, bristles: 2 });
    for (let k = 0; k < 4; k++) dot(art, x0 + bowr + 1.5 + k * 1.4, top + 1 + k * 1.3, 0.28, 0.5, sd * 5 + k);
  };
  reed(38, 34, 7, 111, 0.62);
  reed(42, 25, 11, 112, 0.5);
  reed(46, 40, 5.5, 113, 0.68);
  reed(49, 30, 14, 114, 0.4);
  reed(43, 47, 3.5, 117, 0.55);
  reed(52, 44, 17, 118, 0.32);
  st(art, [28, 90.5], [58, 90], { seed: 115, w0: 0.5, w1: 0.25, alpha: 0.2, dryStart: 0.2, dryMax: 0.9, bristles: 2 });
  st(art, [34, 93], [52, 92.6], { seed: 116, w0: 0.4, w1: 0.2, alpha: 0.12, dryStart: 0.2, dryMax: 0.92, bristles: 2 });
}
function w07_falls(art) {
  // 崖体:宽笔淡墨成块,内缘浓笔勾出水口
  st(art, [27, 22], [37, 84], { seed: 121, w0: 7.5, w1: 6, alpha: 0.3, dryStart: 0.78, dryMax: 0.4, bow: -2, bristles: 4, thRange: [0.34, 0.5] });
  st(art, [17, 32], [27, 88], { seed: 122, w0: 5.5, w1: 4.5, alpha: 0.2, bow: -1.5, bristles: 3, thRange: [0.36, 0.5], dryStart: 0.8, dryMax: 0.35 });
  st(art, [66, 18], [59, 78], { seed: 123, w0: 6.5, w1: 5, alpha: 0.32, bow: 2, bristles: 4, thRange: [0.34, 0.5], dryStart: 0.78, dryMax: 0.4 });
  st(art, [77, 27], [70, 86], { seed: 124, w0: 5, w1: 4, alpha: 0.22, bow: 1.5, bristles: 3, thRange: [0.36, 0.5], dryStart: 0.8, dryMax: 0.35 });
  st(art, [40.5, 24], [43.5, 82], { seed: 133, w0: 1.3, w1: 0.5, alpha: 0.55, bow: -1, dryStart: 0.4, dryMax: 0.9, bristles: 3 });
  st(art, [62, 20], [56.5, 76], { seed: 134, w0: 1.2, w1: 0.5, alpha: 0.55, bow: 1, dryStart: 0.4, dryMax: 0.9, bristles: 3 });
  for (let k = 0; k < 3; k++)
    st(art, [46.5 + k * 2.4, 26], [45.5 + k * 2.6, 80], { seed: 125 + k, w0: 0.5, w1: 0.35, alpha: 0.08, dryStart: 0.3, dryMax: 0.85, bristles: 2 });
  wash(art, 51, 86, 13, 0.09, 128, 0.4);
  const rnd = mulberry32(129);
  for (let k = 0; k < 8; k++) dot(art, 44 + rnd() * 14, 80 + rnd() * 7, 0.24 + rnd() * 0.2, 0.3, 130 + k);
}
function w08_pine(art) {
  cv(art, [[27, 89], [35, 67], [30, 49], [41, 33]], { seed: 131, w0: 2.1, w1: 1.0, alpha: 0.5, dryStart: 0.4, dryMax: 0.88 });
  st(art, [39, 36], [64, 32.5], { seed: 132, w0: 1.0, w1: 0.45, bow: -2.6, alpha: 0.48, dryStart: 0.5 });
  // 松针:车轮式满圈细针,紧贴枝端
  const fan = (cx, cy, sd, sc = 1) => {
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 + sd * 0.3;
      const len = (4.6 + hash1(k, sd) * 1.6) * sc;
      st(art, [cx, cy], [cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.88], { seed: sd + k, w0: 0.42 * sc, w1: 0.02, alpha: 0.55, tipEnd: true, bristles: 1, haloAlpha: 0 });
    }
    dot(art, cx, cy, 0.3 * sc, 0.6, sd + 99);
  };
  fan(63.5, 31.5, 141);
  fan(53, 34.5, 151, 0.85);
  fan(42.5, 30, 161, 0.8);
  // 树干苔点:锚在干线上
  const trunk = catmullFn([[27, 89], [35, 67], [30, 49], [41, 33]].map((p) => [p[0] * U, p[1] * U]));
  for (let k = 0; k < 6; k++) {
    const p = trunk(0.18 + k * 0.13);
    dot(art, p.x / U + (hash1(k, 3) - 0.5) * 1.6, p.y / U + (hash1(k, 5) - 0.5) * 1.6, 0.32 + hash1(k, 7) * 0.2, 0.55, 172 + k);
  }
}
function w09_fish(art) {
  // 鲤:头部墨团 + 身弧收尖 + 眼在头内 + 尾分叉 + 胸鳍
  const fish = (head, mid, tail, sc, al, sd, flip) => {
    art.soft.push(elongBlob(strokePath([head[0] * U, head[1] * U], [mid[0] * U, mid[1] * U], 0), 0.06, 2.1 * sc * U, 1.5 * sc * U, sd, INK, al + 0.1));
    cv(art, [head, mid, tail], { seed: sd, w0: 2.9 * sc, w1: 0.25, alpha: al, press: 0.25, tipEnd: true, bristles: 6 });
    const dx = flip ? -1 : 1;
    st(art, tail, [tail[0] + 5.5 * dx * sc, tail[1] - 3.4 * sc], { seed: sd + 1, w0: 0.9 * sc, w1: 0.04, alpha: al - 0.08, tipEnd: true, bristles: 2 });
    st(art, tail, [tail[0] + 6 * dx * sc, tail[1] + 1.6 * sc], { seed: sd + 2, w0: 0.8 * sc, w1: 0.04, alpha: al - 0.12, tipEnd: true, bristles: 2 });
    art.ink.push(`<circle cx="${r2((head[0] + 1.1 * dx * sc) * U)}" cy="${r2((head[1] - 0.5 * sc) * U)}" r="${r2(0.3 * sc * U)}" fill="${PAPER}" fill-opacity="0.85"/>`);
    dot(art, head[0] + 1.1 * dx * sc, head[1] - 0.5 * sc, 0.17 * sc, 0.9, sd + 3);
    st(art, [head[0] + 1.6 * dx * sc, head[1] + 1.4 * sc], [head[0] + 3.6 * dx * sc, head[1] + 3.6 * sc], { seed: sd + 4, w0: 0.55 * sc, w1: 0.04, alpha: al - 0.15, tipEnd: true, bristles: 1 });
  };
  fish([35, 38.5], [46, 43.5], [58, 39.5], 1, 0.6, 181, false);
  fish([62, 61], [53, 65], [43, 61.5], 0.78, 0.45, 191, true);
  st(art, [28, 51], [41, 50.4], { seed: 189, w0: 0.35, w1: 0.15, alpha: 0.12, dryStart: 0.2, dryMax: 0.9, bristles: 2 });
  st(art, [57, 52], [69, 51.5], { seed: 190, w0: 0.35, w1: 0.15, alpha: 0.1, dryStart: 0.2, dryMax: 0.9, bristles: 2 });
}
function w10_pagoda(art) {
  wash(art, 50, 78, 21, 0.2, 201, 0.32);
  const roofs = [
    [12, 70],
    [10, 63],
    [8, 56.5],
    [6.4, 50.5],
    [5, 45],
  ];
  for (let k = 0; k < roofs.length; k++) {
    const [hw, y] = roofs[k];
    st(art, [50 - hw, y], [50 + hw, y - 0.4], { seed: 211 + k, w0: 1.25, bow: -1.5, alpha: 0.55, tipBoth: true, dryStart: 0.85, bristles: 4 });
    if (k < roofs.length - 1) {
      const [hw2, y2] = roofs[k + 1];
      st(art, [50 - hw2 * 0.62, y - 0.6], [50 - hw2 * 0.62, y2 + 0.7], { seed: 221 + k, w0: 0.45, alpha: 0.46, bristles: 2 });
      st(art, [50 + hw2 * 0.62, y - 0.7], [50 + hw2 * 0.62, y2 + 0.6], { seed: 231 + k, w0: 0.45, alpha: 0.46, bristles: 2 });
    }
  }
  st(art, [50, 44.6], [50, 38.5], { seed: 241, w0: 0.5, w1: 0.1, alpha: 0.6, tipEnd: true, bristles: 2 });
  dot(art, 50, 37.8, 0.4, 0.6, 242);
}
function w11_swallow(art) {
  cv(art, [[11, 3], [18, 22], [15.5, 46]], { seed: 251, w0: 0.75, w1: 0.18, alpha: 0.52, tipEnd: true, bristles: 2 });
  cv(art, [[16, 2], [24, 18], [23, 39]], { seed: 252, w0: 0.65, w1: 0.15, alpha: 0.42, tipEnd: true, bristles: 2 });
  cv(art, [[21, 2], [29, 14], [30, 30]], { seed: 258, w0: 0.55, w1: 0.12, alpha: 0.34, tipEnd: true, bristles: 2 });
  const rnd = mulberry32(253);
  for (let k = 0; k < 14; k++) {
    const t = 0.15 + rnd() * 0.75;
    const x = 13 + t * 8 + rnd() * 10;
    const y = 5 + t * 36;
    st(art, [x, y], [x + 1.9 + rnd(), y + 1.3], { seed: 254 + k, w0: 0.55, w1: 0.03, alpha: 0.55, tipEnd: true, bristles: 1 });
  }
  const bird = (cx, cy, sc, al, sd) => {
    st(art, [cx, cy], [cx - 9 * sc, cy - 5.4 * sc], { seed: sd, w0: 1.15 * sc, w1: 0.06, bow: 2.2 * sc, alpha: al, tipEnd: true, bristles: 3 });
    st(art, [cx, cy], [cx + 8.4 * sc, cy - 6.6 * sc], { seed: sd + 1, w0: 1.05 * sc, w1: 0.06, bow: -2.2 * sc, alpha: al, tipEnd: true, bristles: 3 });
    dot(art, cx, cy + 0.3 * sc, 0.72 * sc, al + 0.15, sd + 2);
    st(art, [cx + 0.3 * sc, cy + 0.8 * sc], [cx + 2.6 * sc, cy + 3.2 * sc], { seed: sd + 3, w0: 0.4 * sc, w1: 0.03, alpha: al, tipEnd: true, bristles: 1 });
    st(art, [cx - 0.1 * sc, cy + 0.9 * sc], [cx + 1 * sc, cy + 3.6 * sc], { seed: sd + 4, w0: 0.36 * sc, w1: 0.03, alpha: al - 0.06, tipEnd: true, bristles: 1 });
  };
  bird(54, 34, 1, 0.62, 261);
  bird(68, 52, 0.72, 0.5, 271);
  bird(41, 57, 0.55, 0.38, 281);
}
function w12_lotus(art) {
  // 荷叶:淡墨大晕 + 缘口深笔 + 放射叶脉(不满径,留边)
  wash(art, 43, 58, 15, 0.18, 291, 0.92);
  wash(art, 43, 58, 15.8, 0.07, 292, 0.95);
  for (let k = 0; k < 7; k++) {
    const a = -0.5 + k * 0.86;
    st(art, [43 + Math.cos(a) * 1.6, 58 + Math.sin(a) * 1.4], [43 + Math.cos(a) * 12, 58 + Math.sin(a) * 10.8], { seed: 293 + k, w0: 0.5, w1: 0.05, bow: (k % 2 ? 0.8 : -0.8), alpha: 0.26, tipEnd: true, bristles: 2 });
  }
  // 叶缘提笔三段
  st(art, [30.5, 52], [36, 46.5], { seed: 306, w0: 0.7, w1: 0.1, bow: -1.8, alpha: 0.3, tipEnd: true, bristles: 2 });
  st(art, [51, 47], [56.5, 54], { seed: 307, w0: 0.7, w1: 0.1, bow: -1.6, alpha: 0.3, tipEnd: true, bristles: 2 });
  st(art, [33, 68.5], [42, 71.5], { seed: 308, w0: 0.7, w1: 0.1, bow: 1.6, alpha: 0.28, tipEnd: true, bristles: 2 });
  // 花茎与尖苞
  cv(art, [[55.5, 53], [60.5, 40], [64.8, 28]], { seed: 301, w0: 0.7, w1: 0.4, alpha: 0.5, bristles: 3 });
  st(art, [63.4, 27.2], [66, 18.6], { seed: 302, w0: 1.5, w1: 0.08, bow: 1.1, alpha: 0.5, tipEnd: true, bristles: 3 });
  st(art, [68.4, 26.6], [66, 18.6], { seed: 303, w0: 1.35, w1: 0.08, bow: -1.1, alpha: 0.46, tipEnd: true, bristles: 3 });
  st(art, [65.8, 27.4], [66.1, 21], { seed: 309, w0: 0.8, w1: 0.06, alpha: 0.4, tipEnd: true, bristles: 2 });
  art.ink.push(`<path d="${blobPath(66 * U, 19.4 * U, 0.5 * U, 305, 0.18)}" fill="${SEAL_RED}" fill-opacity="0.35"/>`);
  st(art, [30, 76], [56, 75.4], { seed: 304, w0: 0.4, w1: 0.2, alpha: 0.13, dryStart: 0.2, dryMax: 0.9, bristles: 2 });
}
function w13_bridge(art) {
  // 单拱:拱身 + 沿拱栏杆与望柱 + 倒影成目
  st(art, [22, 58], [78, 58], { seed: 311, w0: 2.0, bow: -13.5, alpha: 0.55, dryStart: 0.45, dryMax: 0.7, bristles: 6 });
  st(art, [24, 55.2], [76, 55.2], { seed: 312, w0: 0.5, bow: -12.6, alpha: 0.42, bristles: 2 });
  const arch = strokePath([24 * U, 55.2 * U], [76 * U, 55.2 * U], -12.6 * U);
  for (let k = 0; k < 5; k++) {
    const p = arch(0.18 + k * 0.16);
    st(art, [p.x / U, p.y / U], [p.x / U, p.y / U - 1.9], { seed: 313 + k, w0: 0.38, w1: 0.14, alpha: 0.48, bristles: 1, haloAlpha: 0 });
  }
  st(art, [28, 62.5], [72, 62.5], { seed: 315, w0: 1.2, bow: 8.5, alpha: 0.1, dryStart: 0.15, dryMax: 0.95, bristles: 4 });
  st(art, [10, 64.5], [26, 63.6], { seed: 316, w0: 0.5, w1: 0.2, alpha: 0.17, dryStart: 0.3, dryMax: 0.85, bristles: 2 });
  st(art, [74, 63.8], [90, 64.6], { seed: 317, w0: 0.5, w1: 0.2, alpha: 0.15, dryStart: 0.3, dryMax: 0.85, bristles: 2 });
}
function w14_rain(art) {
  st(art, [30, 63.5], [50, 59.5], { seed: 321, w0: 1.5, bow: 1.6, alpha: 0.58, tipBoth: true, dryStart: 0.85, bristles: 4 });
  st(art, [50, 59.5], [67, 65], { seed: 322, w0: 1.3, bow: -1.6, alpha: 0.55, tipBoth: true, dryStart: 0.85, bristles: 4 });
  st(art, [38, 71.5], [58, 68.5], { seed: 323, w0: 1.1, bow: 1.2, alpha: 0.34, tipBoth: true, bristles: 3 });
  st(art, [44, 64], [44.5, 70.5], { seed: 324, w0: 0.5, alpha: 0.35, bristles: 2 });
  st(art, [53, 63.5], [53.5, 69], { seed: 325, w0: 0.5, alpha: 0.32, bristles: 2 });
  const rnd = mulberry32(326);
  for (let k = 0; k < 19; k++) {
    const x = 12 + rnd() * 74;
    const y = 6 + rnd() * 44;
    const len = 10 + rnd() * 7;
    const ang = 1.92 + (rnd() - 0.5) * 0.07;
    st(art, [x, y], [x + Math.cos(ang) * len * -0.4, y + Math.sin(ang) * len], { seed: 327 + k, w0: 0.38, w1: 0.05, alpha: 0.14 + rnd() * 0.12, tipEnd: true, bristles: 1, haloAlpha: 0 });
  }
}
function w15_script(art) {
  cv(
    art,
    [
      [31, 28],
      [55, 24],
      [66, 40],
      [47, 52],
      [37, 68],
      [57, 74],
      [70, 63],
    ],
    { seed: 331, w0: 2.7, w1: 0.4, press: 0.5, alpha: 0.6, dryStart: 0.5, dryMax: 0.92, tipEnd: true, bristles: 8, samples: 300 }
  );
  dot(art, 71.5, 28, 1.5, 0.68, 332);
}

const WALL_PIECES = [
  { fn: w01_bamboo, seal: [88, 88] },
  { fn: w02_peaks, seal: [88, 88] },
  { fn: w03_boat, seal: [13, 86] },
  { fn: w04_plum, seal: [86, 14] },
  { fn: w05_moon, seal: [86, 87] },
  { fn: w06_reeds, seal: [14, 13] },
  { fn: w07_falls, seal: [88, 12] },
  { fn: w08_pine, seal: [86, 87] },
  { fn: w09_fish, seal: [14, 14] },
  { fn: w10_pagoda, seal: [87, 87] },
  { fn: w11_swallow, seal: [86, 88] },
  { fn: w12_lotus, seal: [86, 13] },
  { fn: w13_bridge, seal: [13, 14] },
  { fn: w14_rain, seal: [87, 88] },
  { fn: w15_script, seal: [14, 87] },
];

async function walls() {
  fs.mkdirSync(path.join(OUT_DIR, "wall"), { recursive: true });
  for (let i = 0; i < WALL_PIECES.length; i++) {
    const piece = WALL_PIECES[i];
    const art = newArt();
    piece.fn(art);
    const speckle = granulate(art.runs, 400 + i, 420);
    const seal = sealSvg(piece.seal[0] * U, piece.seal[1] * U, S * 0.04, 500 + i);
    const name = `w${String(i + 1).padStart(2, "0")}.webp`;
    await composeArtwork({
      haloParts: art.halo,
      washParts: art.wash,
      softParts: art.soft,
      inkParts: [...art.ink, ...speckle],
      sealParts: [seal],
      outName: path.join("wall", name),
      size: 640,
    });
    console.log("wall", name);
  }
}
/** 4x4 样张:15 件 + hero,一图审阅 */
async function sheet() {
  const files = [];
  for (let i = 1; i <= 15; i++) files.push(path.join(OUT_DIR, "wall", `w${String(i).padStart(2, "0")}.webp`));
  files.push(path.join(OUT_DIR, "artwork-hero.webp"));
  const cells = [];
  for (let i = 0; i < files.length; i++) {
    cells.push({
      input: await sharp(files[i]).resize(320, 320).png().toBuffer(),
      left: (i % 4) * 320,
      top: Math.floor(i / 4) * 320,
    });
  }
  await sharp({ create: { width: 1280, height: 1280, channels: 3, background: "#cccccc" } })
    .composite(cells)
    .png()
    .toFile(path.join(PREVIEW_DIR, "wall-sheet.png"));
  console.log("sheet done");
}

// ---------- 入口 ----------
(async () => {
  const mode = process.argv[2] || "hero";
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  if (mode === "hero" || mode === "all") await hero();
  if (mode === "walls" || mode === "all") {
    await walls();
    await sheet();
  }
  if (mode === "sheet") await sheet();
  console.log("ok:", mode);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
