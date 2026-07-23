# 首页影片化 v1.2 实施计划：自研水墨 NPR 管线与三大奇观

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 v1.1 十二幕骨架上落地自研水墨 NPR 管线，完成 dive 3D 山水飞越、展墙墨池真倒影+焦散、macro 笔触浮雕三大奇观，外加光标抚墨交互与镜头签名，全程性能优先、三层回退不动。

**Architecture:** 设计稿 `docs/plan/2026-07-23-homepage-cinema-v12-design.md`。共享 GLSL 库 `gl/ink/chunks.ts` 被三个新 pass（landscape/pool/relief）引用；全部新效果为滚动进度纯函数（倒放成立），经既有 `engine.setProgress` 键喂入；质量档用 ctx.tier 门控子效果，引擎新增单项熔断兜底。

**Tech Stack:** WebGL2（手写迷你引擎，零新依赖）、TypeScript strict、Vitest（纯函数单测）、sharp（离线素材管线）、framer-motion（useScroll/useVelocity）。

**既有代码关键事实（实施前必读，均已核实）：**
- pass 工厂模式：`createXxxPass(...): CinemaPass`，`init/render/dispose`，`render` 内首行查可见门键（`< 0.5` 跳绘）；uniform 位置表 `loc` + `names` 数组。
- 引擎：`engine.setProgress(key, v)` 喂键；`ctx.tier` 为 0|1|2（2=满档）；pass 绘制序 = addPass 序（post 最先注册）。
- 透明画布混合铁律：半透明输出必须 `blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`（alpha 直通），全屏 alpha=1 的 pass 不混合。
- GLSL `smoothstep` 反序边界（edge0>=edge1）未定义，反向映射写 `1.0 - smoothstep(...)`。
- biome 会误报 `gl.useProgram` 为 hook：加 `// biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook`。
- 幕窗口纯函数在 `cinema-config.ts`；`darkWindow()` 供 ChapterRail 与 HeaderDimmer 共用。
- 展墙常量（scene-wall.tsx / cinema-geometry.ts）：STRIP_W 0.36、STRIP_GAP 0.06、STRIP_H 0.52、STRIP_STAGGER 0.045、STRIP_WHISPER_W 0.16、WHISPER_AFTER [3,8,12]、16 格。
- fluid 模拟坐标与视口分数同向（y 自顶向下，INK_CENTER [0.5,0.7] 为视口中偏下）。
- 门禁命令：`pnpm --filter @repo/web exec tsc --noEmit`、`pnpm --filter @repo/web exec biome lint <paths>`、`pnpm --filter @repo/web test`、`pnpm build`（根）。

---

### Task 1: 山水素材管线（gen + ingest）

**Files:**
- Create: `apps/web/scripts/gen-landscape.cjs`
- Create: `apps/web/scripts/ingest-landscape.cjs`
- Output: `apps/web/public/cinema/landscape-paint.webp`、`apps/web/public/cinema/landscape-height.webp`（不入库源图入 `apps/web/scripts/artwork-src/`）

素材叙事：dive 飞越的地形 = AI 生成水墨山水本身。高度图从其亮度推导（墨浓处 = 近山 = 高），并沿中轴线程序化开凿谷道（保证相机可飞越，不依赖运气构图）。

- [ ] **Step 1: 写生成脚本**

`apps/web/scripts/gen-landscape.cjs`（模式与 gen-artworks.cjs 逐行对齐：G2I_API_KEY 环境变量、/v1/images/generations、b64_json、15 分钟超时）：

```js
/**
 * 山水素材生成:经 GPT2IMAGE Pro 自身 v1 API 生成 dive 幕飞越的水墨
 * 山水长卷(1536x1024)。构图硬要求:中景谷道纵深 + 两侧山脊 +
 * 大量留白云雾——谷道供相机飞越,山脊供地形起伏。
 * 用法:G2I_API_KEY=<key> [G2I_BASE=...] node scripts/gen-landscape.cjs
 * 输出:scripts/artwork-src/landscape.png + landscape-manifest.json。
 * 机密纪律:key 仅经环境变量传入,本文件与输出不含任何机密。
 */
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.G2I_BASE || "https://gpt2image.superapi.buzz";
const KEY = process.env.G2I_API_KEY;
if (!KEY) {
  console.error("缺少 G2I_API_KEY 环境变量");
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, "artwork-src");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPT =
  "Traditional Chinese ink wash painting (shuimo) on warm off-white rice" +
  " paper, a vast mountain valley landscape: a low open valley corridor" +
  " in the center receding into misty distance, flanked by layered dark" +
  " ink mountain ridges on left and right sides, nearer ridges darker" +
  " and heavier, distant ridges paler, vast negative space of clouds" +
  " and mist (over 50 percent empty paper), confident brushwork with" +
  " dry-brush texture (feibai), pure black ink monochrome, no color," +
  " no text, no seal, no watermark, wide horizontal composition";

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
  try {
    const res = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: PROMPT,
        size: "1536x1024",
        quality: "high",
        response_format: "b64_json",
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = JSON.parse((await res.text()).trim());
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("响应无 b64_json");
    fs.writeFileSync(
      path.join(OUT_DIR, "landscape.png"),
      Buffer.from(b64, "base64")
    );
    fs.writeFileSync(
      path.join(OUT_DIR, "landscape-manifest.json"),
      JSON.stringify({ size: "1536x1024", prompt: PROMPT }, null, 2)
    );
    console.log("已生成 scripts/artwork-src/landscape.png");
  } finally {
    clearTimeout(timer);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 写接收脚本（白点归一 + 谷道开凿 + 高度图推导）**

`apps/web/scripts/ingest-landscape.cjs`：

```js
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

  // 高度图:灰度 -> 反相(墨=高) -> 归一 -> 平滑 -> 谷道掩膜(逐行乘)
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
  console.log("已输出 public/cinema/landscape-paint.webp 与 landscape-height.webp");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: 运行生成与接收（需要用户提供的 G2I_API_KEY）**

```bash
cd apps/web
G2I_API_KEY=<用户提供的 key> node scripts/gen-landscape.cjs
node scripts/ingest-landscape.cjs
```

预期：两件资产落 `public/cinema/`。人工目检 landscape.png：谷道居中、两侧山脊、云雾留白充足；不合格就调 PROMPT 构图限定词重跑（每张约 1-3 分钟）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/gen-landscape.cjs apps/web/scripts/ingest-landscape.cjs \
  apps/web/public/cinema/landscape-paint.webp apps/web/public/cinema/landscape-height.webp
git commit -m "feat(marketing): dive 山水素材管线——v1 API 生成 + 谷道开凿高度图"
```

---

### Task 2: 水墨 NPR 共享库 gl/ink/chunks.ts

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/ink/chunks.ts`
- Test: `apps/web/src/features/marketing/components/cinema/gl/ink/chunks.test.ts`

GLSL chunk 常量供新 pass 拼接（既有 pass 自带的噪声副本不 refactor——最小侵入）。JS 镜像纯函数锁数值契约，供单测。

- [ ] **Step 1: 写失败测试**

```ts
// gl/ink/chunks.test.ts
import { describe, expect, it } from "vitest";
import { quantizeTone } from "./chunks";

describe("quantizeTone（inkTone 的 JS 镜像，锁墨分五色数值契约）", () => {
  it("端点:纯黑为 0,纯纸白为 1", () => {
    expect(quantizeTone(0, 0)).toBe(0);
    expect(quantizeTone(1, 0)).toBe(1);
  });
  it("单调:亮度升,墨阶不降", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = quantizeTone(i / 20, 0.5);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("量化:无噪声时输出落在 1/levels 网格上", () => {
    for (let i = 0; i <= 100; i++) {
      const v = quantizeTone(i / 100, 0);
      const grid = Math.round(v * 5) / 5;
      expect(Math.abs(v - grid)).toBeLessThan(1e-9);
    }
  });
  it("噪声项有界:|quantizeTone(lum,1) - quantizeTone(lum,0)| <= 1/levels", () => {
    for (let i = 0; i <= 100; i++) {
      const lum = i / 100;
      const diff = Math.abs(quantizeTone(lum, 1) - quantizeTone(lum, 0));
      expect(diff).toBeLessThanOrEqual(1 / 5 + 1e-9);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/gl/ink/chunks.test.ts
```

预期：FAIL（模块不存在）。

- [ ] **Step 3: 实现 chunks.ts**

```ts
/**
 * 水墨 NPR 共享 GLSL 库(v1.2 自研渲染管线核心)。
 * WHY 独立 chunk:landscape/pool/relief 三个新 pass 共用同一套"纸墨水光"
 * 材质函数,一次投入多处复用;既有 pass 的噪声副本不 refactor(最小侵入)。
 * 每项函数必须能翻译成纸/墨/水/光的物理行为(世界观纪律,见设计稿一节)。
 * quantizeTone 为 inkTone 的 JS 镜像(锁数值契约供单测,改动须双同步)。
 */

/** hash/vnoise/fbm/ign:与既有 pass 同源(数值逐位一致,防风格漂移) */
export const INK_NOISE = /* glsl */ `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1, 0)), u.x),
    mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.3) + 0.2 * vnoise(p * 5.1);
}
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

/**
 * 墨分五色:连续亮度量化为 levels 阶;noiseAmt>0 时阶间以噪声阈值
 * 过渡(宣纸洇化边界,非 halftone 网点)。lum/noise 均 [0,1]。
 */
export const INK_TONE = /* glsl */ `
float inkTone(float lum, float noise, float noiseAmt) {
  float levels = 5.0;
  float q = lum * levels + (noise - 0.5) * noiseAmt;
  return clamp(floor(clamp(q, 0.0, levels)) / levels, 0.0, 1.0);
}
`;

/**
 * JS 镜像:与 INK_TONE 数值契约一致(镜像取 noise=0.5 中值,
 * 锁量化网格本体:floor(clamp(lum*levels,0,levels))/levels)。
 * GLSL 侧改动时须同步本函数与 chunks.test.ts。
 */
export function quantizeTone(lum: number, noiseAmt: number): number {
  const levels = 5;
  const noise = 0.5;
  const q = lum * levels + (noise - 0.5) * noiseAmt;
  return Math.min(
    1,
    Math.max(0, Math.floor(Math.min(levels, Math.max(0, q))) / levels)
  );
}

/** 高度图求法线(Sobel 中心差分):墨与纸的物理起伏 */
export const HEIGHT_NORMAL = /* glsl */ `
vec3 heightNormal(sampler2D hTex, vec2 uv, vec2 texel, float scale) {
  float hL = texture(hTex, uv - vec2(texel.x, 0.0)).r;
  float hR = texture(hTex, uv + vec2(texel.x, 0.0)).r;
  float hD = texture(hTex, uv - vec2(0.0, texel.y)).r;
  float hU = texture(hTex, uv + vec2(0.0, texel.y)).r;
  return normalize(vec3((hL - hR) * scale, (hD - hU) * scale, 1.0));
}
`;

/** 皴法:沿坡度方向的各向异性笔触纹理(山水画山石肌理) */
export const CUN_STROKE = /* glsl */ `
float cunStroke(vec2 uv, vec2 slopeDir, float freq) {
  vec2 dir = normalize(slopeDir + vec2(1e-4, 0.0));
  vec2 across = vec2(-dir.y, dir.x);
  float along = dot(uv, dir) * freq;
  float wide = dot(uv, across) * freq * 0.18;
  return fbm(vec2(along, wide));
}
`;

/** 迎光透纸:薄处透光(thickness 低处 glow 强) */
export const PAPER_GLOW = /* glsl */ `
float paperGlow(float thickness, float backLight) {
  return (1.0 - thickness) * backLight;
}
`;

/** 平远留白:深度雾 = 山水画的空间法 */
export const MIST = /* glsl */ `
float mistLayer(float depth, float density) {
  return 1.0 - exp(-max(depth, 0.0) * density);
}
`;
```

（`quantizeTone` 镜像取 noise=0.5，故 Step 1 测试中端点/单调/网格用例即最终形态；"噪声项有界"用例在镜像下退化为恒等，保留作回归哨兵即可。）

- [ ] **Step 4: 跑测试确认通过 + typecheck + lint**

```bash
pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/gl/ink/chunks.test.ts
pnpm --filter @repo/web exec tsc --noEmit
pnpm --filter @repo/web exec biome lint src/features/marketing/components/cinema/gl/ink/
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/gl/ink/
git commit -m "feat(marketing): 水墨 NPR 共享库——墨分五色/法线/皴法/透光/留白"
```

---

### Task 3: 山水相机样条纯函数 landscape-path.ts

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/landscape-path.ts`
- Test: `apps/web/src/features/marketing/components/cinema/gl/landscape-path.test.ts`

世界坐标约定：x ∈ [-2.2, 2.2]（谷道近 x=0），z ∈ [1, -12]（负 z 纵深），y 为高度（地形 = heightmap × HEIGHT_SCALE）。相机沿谷道低空飞越，末端拉起入雾。

- [ ] **Step 1: 写失败测试**

```ts
// gl/landscape-path.test.ts
import { describe, expect, it } from "vitest";
import { HEIGHT_SCALE, landscapeCam } from "./landscape-path";

describe("landscapeCam 相机样条", () => {
  it("端点:p=0 在谷口外,p=1 抵近终段山脊", () => {
    const a = landscapeCam(0);
    const b = landscapeCam(1);
    expect(a.pos[2]).toBeGreaterThan(0.5);
    expect(b.pos[2]).toBeLessThan(-9.5);
  });
  it("前进单调:z 随 p 严格减小", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 100; i++) {
      const { pos } = landscapeCam(i / 100);
      expect(pos[2]).toBeLessThan(prev);
      prev = pos[2];
    }
  });
  it("相机恒在谷道走廊内且高于最低安全高度", () => {
    for (let i = 0; i <= 100; i++) {
      const { pos } = landscapeCam(i / 100);
      expect(Math.abs(pos[0])).toBeLessThan(0.7);
      // 谷道开凿后走廊高度 <= 0.25(ingest 掩膜),相机须留余量
      expect(pos[1]).toBeGreaterThan(0.25 * HEIGHT_SCALE + 0.05);
    }
  });
  it("视点恒在相机前方", () => {
    for (let i = 0; i <= 100; i++) {
      const { pos, look } = landscapeCam(i / 100);
      expect(look[2]).toBeLessThan(pos[2]);
    }
  });
  it("纯函数:同参同出(倒放成立的根基)", () => {
    const a = landscapeCam(0.37);
    const b = landscapeCam(0.37);
    expect(a.pos).toEqual(b.pos);
    expect(a.look).toEqual(b.look);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 实现 landscape-path.ts**

```ts
/**
 * 山水飞越相机样条(v1.2 奇观一):全部量为飞行进度 p 的确定性纯函数,
 * 滚回即倒放。世界约定:x 谷道近 0,z 自 +1(谷口)向 -12(远山),
 * y 向上;地形高度 = heightmap * HEIGHT_SCALE(高度图已经 ingest
 * 谷道掩膜,走廊 |x|<0.4 内高度 <= 0.25)。
 */

export const HEIGHT_SCALE = 0.42;

/** 谷道走廊半宽(世界单位),ingest 掩膜中心 0.08..0.35 过渡带对应 */
const CORRIDOR_X = 0.55;

export interface CamFrame {
  pos: readonly [number, number, number];
  look: readonly [number, number, number];
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/**
 * 相机机位:z 匀速纵深(线性推轨的手感);x 为低频 S 形摆动
 * (穿行感,两端收敛归零防起止侧移);y 中段压低谷内穿行、
 * 末端拉起(越过终段山脊前抬头入雾)。
 */
export function landscapeCam(p: number): CamFrame {
  const c = clamp01(p);
  const z = 1 - 11.5 * c;
  const sway = Math.sin(c * Math.PI * 2.1) * CORRIDOR_X * smooth(c * 4) * (1 - smooth((c - 0.82) / 0.18));
  const x = sway;
  const cruise = 0.34 - 0.1 * smooth((c - 0.1) / 0.35);
  const pull = 0.55 * smooth((c - 0.78) / 0.2);
  const y = cruise + pull;
  const lookX = x * 0.55 + Math.sin(c * Math.PI * 3.2) * 0.08;
  const lookY = y - 0.07 - 0.1 * smooth((c - 0.78) / 0.2);
  return {
    pos: [x, y, z],
    look: [lookX, lookY, z - 2.4],
  };
}
```

注意测试 3 的下界：`0.25 * HEIGHT_SCALE + 0.05 = 0.155`；cruise 最低 `0.34-0.1=0.24 > 0.155` 成立。

- [ ] **Step 4: 跑测试确认通过 + typecheck**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/gl/landscape-path.ts apps/web/src/features/marketing/components/cinema/gl/landscape-path.test.ts
git commit -m "feat(marketing): 山水飞越相机样条纯函数与单测"
```

---

### Task 4: 山水飞越 pass（gl/passes/landscape.ts）

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/landscape.ts`
- Modify: `apps/web/src/features/marketing/components/cinema/cinema-film.tsx`（装载 pass）

两个 draw：先全屏天光三角（纸白 + fbm 云絮 + 雾），再地形网格（gl_VertexID 派生，128x64 quads，VS 采样高度图顶起）。着色 = 真画皮肤 × 墨分五色 × 皴法 × 平远雾。DOF 用 mip bias（跟焦 uniform）。手持 = 相机加低频偏移（tier>=2）。

- [ ] **Step 1: 实现 landscape.ts**

```ts
/**
 * 山水飞越 pass(v1.2 奇观一「入画·千里江山」)。
 * 飞越的就是 AI 生成的真画本身:地形网格贴画作皮肤,高度图顶起
 * 山脊,墨分五色量化 + 皴法肌理 + 平远留白雾;天光为纸白云絮。
 * 单 draw 网格(gl_VertexID 派生,零缓冲区)+ 全屏天光,无 raymarch,
 * fbm <= 4 octaves,预算约 1ms;相机为进度纯函数(倒放成立)。
 * 读 progress 键:landscapeVisible(< 0.5 跳绘,缺省不可见)/
 * landscapeP(0-1 飞行进度)/landscapeFog(0-1 雾密度,1=全白场)/
 * landscapeRise(0-1 山形隆起,墨坠成山)/focusDepth(跟焦 0-1)/
 * handX/handY(手持偏移,tier<2 忽略)/scrollVel(速度,加雾流)。
 * cost: 3(单项熔断候选,被熔断后 dive 回退 2.5D dolly)。
 */
import {
  type CinemaPass,
  compileProgram,
  FULLSCREEN_VS,
  type PassContext,
} from "../engine";
import { HEIGHT_SCALE, landscapeCam } from "../landscape-path";
import { CUN_STROKE, INK_NOISE, INK_TONE, MIST } from "../ink/chunks";

const COLS = 128;
const ROWS = 64;
const WORLD_W = 4.4;
// 纵深:近端 0.0 在相机身后半位(防近平面涂抹),远端 -13 没入雾;
// 相机 z 自 +1 行至 -10.5(landscape-path),全程地形在前方
const WORLD_NEAR = 0.0;
const WORLD_FAR = -13.0;

const SKY_FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uFog;
out vec4 outColor;
${INK_NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  // 纸白为底(与 denoise 纸色同源),高处略亮,云絮为淡墨丝
  vec3 paper = vec3(0.955, 0.945, 0.915);
  float wisps = fbm(vec2(uv.x * 3.1, uv.y * 1.7 + 4.2));
  float cloud = smoothstep(0.55, 0.85, wisps) * 0.06;
  vec3 col = paper - vec3(cloud);
  col = mix(col, paper, uFog);
  outColor = vec4(col, 1.0);
}`;

const TERRA_VS = `#version 300 es
precision highp float;
uniform sampler2D uHeight;
uniform vec2 uSize;
uniform vec3 uCam;
uniform vec3 uLook;
uniform float uRise;
uniform vec2 uHand;
out vec2 vUv;
out float vDepth;
out float vH;

// 网格:COLS x ROWS 个 quad,每 quad 6 顶点,全由 gl_VertexID 派生
const int COLS_I = ${COLS};
const int ROWS_I = ${ROWS};

void main() {
  int vid = gl_VertexID;
  int quad = vid / 6;
  int corner = vid - quad * 6;
  int cx = quad - (quad / COLS_I) * COLS_I;
  // 画家算法:无深度缓冲,行序翻转为远->近绘制,近景才能正确遮挡远山
  int cy = ROWS_I - 1 - (quad / COLS_I);
  // corner: 0,1,2 / 2,1,3 两三角
  ivec2 offs[4] = ivec2[4](
    ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 1)
  );
  int oi = corner == 0 ? 0 : corner == 1 ? 1 : corner == 2 ? 2
    : corner == 3 ? 2 : corner == 4 ? 1 : 3;
  ivec2 cell = ivec2(cx, cy) + offs[oi];
  vec2 grid = vec2(float(cell.x) / float(COLS_I), float(cell.y) / float(ROWS_I));
  // 世界映射:x 宽幅,z 自近及远;painting uv:v 近处贴画底
  float x = (grid.x - 0.5) * ${WORLD_W.toFixed(1)};
  float z = ${WORLD_NEAR.toFixed(1)} + grid.y * ${(WORLD_FAR - WORLD_NEAR).toFixed(1)};
  vec2 uv = vec2(grid.x, 1.0 - grid.y);
  float h = textureLod(uHeight, uv, 0.0).r;
  vec3 world = vec3(x, h * ${HEIGHT_SCALE} * uRise, z);
  // 针孔相机:手持偏移只动机位(纹理层,不动 DOM)
  vec3 cam = uCam + vec3(uHand * 0.006, 0.0);
  vec3 fwd = normalize(uLook - cam);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rel = world - cam;
  float vz = max(dot(rel, fwd), 0.02);
  float px = dot(rel, right) / vz;
  float py = dot(rel, up) / vz;
  float focal = 1.35;
  float aspect = uSize.x / uSize.y;
  gl_Position = vec4(px * focal / aspect, py * focal, 0.5, 1.0);
  vUv = uv;
  vDepth = vz;
  vH = h;
}`;

const TERRA_FS = `#version 300 es
precision highp float;
uniform sampler2D uPaint;
uniform sampler2D uHeight;
uniform float uFog;
uniform float uFocus;
uniform float uVel;
in vec2 vUv;
in float vDepth;
in float vH;
out vec4 outColor;
${INK_NOISE}
${INK_TONE}
${CUN_STROKE}
${MIST}
void main() {
  // 跟焦 DOF:离焦平面越远 mip 越糊(水墨晕染式 soft blur)
  float lod = clamp(abs(vDepth - uFocus * 12.0) * 0.55, 0.0, 2.6);
  vec3 art = textureLod(uPaint, vUv, lod).rgb;
  float lum = dot(art, vec3(0.299, 0.587, 0.114));
  // 墨分五色:量化阶间以画内颗粒过渡(洇化边界)
  float tone = inkTone(lum, fbm(vUv * 31.0), 0.9);
  vec3 col = mix(art, vec3(tone), 0.42);
  // 皴法:沿高度坡度的各向异性笔触,山脊肌理随高度显
  float hR = textureLod(uHeight, vUv + vec2(1.0 / 512.0, 0.0), 0.0).r;
  float hU = textureLod(uHeight, vUv + vec2(0.0, 1.0 / 256.0), 0.0).r;
  vec2 slope = vec2(hR - vH, hU - vH);
  float cun = cunStroke(vUv * 14.0, slope * 40.0, 1.0);
  col *= 1.0 - smoothstep(0.6, 0.95, cun) * 0.14 * smoothstep(0.15, 0.6, vH);
  // 平远留白:纵深雾 + 滚动速度加雾流(快滚雾动)
  float fogAmt = mistLayer(vDepth, 0.16 + uVel * 0.1);
  fogAmt = max(fogAmt, uFog);
  vec3 paper = vec3(0.955, 0.945, 0.915);
  col = mix(col, paper, clamp(fogAmt, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}`;

/** 带 mipmap 的纹理(DOF lod 采样需要;线性过滤+边缘钳制) */
function createMipTexture(
  gl: WebGL2RenderingContext,
  source: TexImageSource
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("createTexture 失败");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

export function createLandscapePass(
  paint: TexImageSource,
  height: TexImageSource
): CinemaPass {
  let skyProg: WebGLProgram | null = null;
  let terraProg: WebGLProgram | null = null;
  let paintTex: WebGLTexture | null = null;
  let heightTex: WebGLTexture | null = null;
  const skyLoc: Record<string, WebGLUniformLocation | null> = {};
  const loc: Record<string, WebGLUniformLocation | null> = {};
  return {
    key: "landscape",
    enabled: true,
    cost: 3,
    init(gl) {
      skyProg = compileProgram(gl, FULLSCREEN_VS, SKY_FS);
      terraProg = compileProgram(gl, TERRA_VS, TERRA_FS);
      paintTex = createMipTexture(gl, paint);
      heightTex = createMipTexture(gl, height);
      for (const n of ["uSize", "uFog"] as const) {
        skyLoc[n] = gl.getUniformLocation(skyProg, n);
      }
      for (const n of [
        "uHeight",
        "uSize",
        "uCam",
        "uLook",
        "uRise",
        "uHand",
        "uPaint",
        "uFog",
        "uFocus",
        "uVel",
      ] as const) {
        loc[n] = gl.getUniformLocation(terraProg, n);
      }
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!skyProg || !terraProg || !paintTex || !heightTex) return;
      if ((progress.get("landscapeVisible") ?? 0) < 0.5) return;
      const p = progress.get("landscapeP") ?? 0;
      const fog = progress.get("landscapeFog") ?? 0;
      const rise = progress.get("landscapeRise") ?? 1;
      const { pos, look } = landscapeCam(p);
      const tier = ctx.tier;
      const handX = tier >= 2 ? (progress.get("handX") ?? 0) : 0;
      const handY = tier >= 2 ? (progress.get("handY") ?? 0) : 0;
      // 天光底
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(skyProg);
      gl.uniform2f(skyLoc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(skyLoc.uFog ?? null, fog);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 地形
      gl.useProgram(terraProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, paintTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, heightTex);
      gl.uniform1i(loc.uPaint ?? null, 0);
      gl.uniform1i(loc.uHeight ?? null, 1);
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform3f(loc.uCam ?? null, pos[0], pos[1], pos[2]);
      gl.uniform3f(loc.uLook ?? null, look[0], look[1], look[2]);
      gl.uniform1f(loc.uRise ?? null, rise);
      gl.uniform2f(loc.uHand ?? null, handX, handY);
      gl.uniform1f(loc.uFog ?? null, fog);
      gl.uniform1f(loc.uFocus ?? null, progress.get("focusDepth") ?? 0.5);
      gl.uniform1f(loc.uVel ?? null, progress.get("scrollVel") ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, COLS * ROWS * 6);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      if (skyProg) gl.deleteProgram(skyProg);
      if (terraProg) gl.deleteProgram(terraProg);
      if (paintTex) gl.deleteTexture(paintTex);
      if (heightTex) gl.deleteTexture(heightTex);
      skyProg = null;
      terraProg = null;
      paintTex = null;
      heightTex = null;
    },
  };
}
```

注意：`CinemaPass` 接口尚无 `cost` 字段、engine 尚无 `hasPass/isDisabled`——本任务 **Step 0** 在 `engine.ts` 做纯类型/占位扩展（零行为变化，Task 10 替换为真实熔断状态）：

```ts
// CinemaPass 接口加一行:
/** 单项熔断候选的相对成本权重(缺省不参与熔断) */
cost?: number;

// CinemaEngine 加两个方法:
hasPass(key: string): boolean {
  return this.passes.some((p) => p.key === key);
}

/** 占位:Task 10 接入真实熔断状态前恒 false */
isDisabled(_key: string): boolean {
  return false;
}
```

- [ ] **Step 2: cinema-film.tsx 装载**

`FilmPasses` 中 `dollyReady` 之后追加 landscape 资产加载与注册（在 dolly 之后、fluid 之前 addPass）：

```ts
const landscapePaintReady = loadImage("/cinema/landscape-paint.webp");
const landscapeHeightReady = loadImage("/cinema/landscape-height.webp");
// Promise.all 数组扩为 6 元;解构后:
if (lp && lh) engine.addPass(createLandscapePass(lp, lh));
```

import 顶部加：

```ts
import { createLandscapePass } from "./gl/passes/landscape";
```

资产缺失时跳过（`if (lp && lh)`），dive 由 dolly 全程兜底（Task 5 的编排用 `engine.hasPass("landscape")` 判定走 dolly 全程分支；hasPass 由本任务 Step 0 在 engine 落地）。

- [ ] **Step 3: typecheck + lint + 既有测试**

```bash
pnpm --filter @repo/web exec tsc --noEmit
pnpm --filter @repo/web exec biome lint src/features/marketing/components/cinema/
pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(marketing): 山水飞越 pass——真画皮肤地形 + 墨阶皴法 + 平远雾"
```

---

### Task 5: dive 重编排（320vh + 墨坠成山 + 白场接墨章）

**Files:**
- Modify: `apps/web/src/features/marketing/components/cinema/cinema-config.ts`（dive 320vh、darkWindow 公式、注释）
- Modify: `apps/web/src/features/marketing/components/cinema/transitions.tsx`（ZoomThroughTransition 重写）
- Modify: `apps/web/src/features/marketing/components/cinema/gl/passes/fluid.ts`（gather 目标改键驱动）
- Test: `apps/web/src/features/marketing/components/cinema/cinema-config.test.ts`（更新）

dive 幕内分镜（幕内进度 v，320vh）：
- [0, 0.28] dolly 推轨（zoom 1→18，smear 钟形，暖光纤维隧道，不压暗）
- [0.25, 0.5] 墨坠：fluid 活墨（inkFade 钟形峰 0.85@0.36、inkGather=1 目标 [0.5,0.9]）+ landscape 自全白雾中显形（fog 1→0.5，rise 0→1）
- [0.3, 0.92] 飞越：landscapeP 0→1，fog 续降至 0.12
- [0.85, 0.95] 雾出白场：fog → 1
- [0.92, 1] 墨潮回灌：fluidP 0→1（既有 dive 模式）接 manifesto

- [ ] **Step 1: config 改行程与暗场窗口**

`cinema-config.ts`：`{ key: "dive", lengthVh: 200 }` → `{ key: "dive", lengthVh: 320 }`；注释更新（v1.2：dive 扩为入画飞越，总行程 3230vh）。

`darkWindow()` 的 start 公式 `dive.start + (dive.end - dive.start) * 0.6` → `* 0.92`（暗场自墨潮回灌起）。

跑既有 config 测试，按失败信息更新期望（总 vh / 窗口分数），不弱化断言。

- [ ] **Step 2: fluid.ts gather 目标键驱动**

`applyGather` 中 `gl.uniform2f(loc.uTarget ?? null, GATHER_TARGET[0], GATHER_TARGET[1])` 改为按参数传入；`step` 签名加 `gatherTarget: readonly [number, number]`；`render` 中：

```ts
const gatherTarget: readonly [number, number] = [
  progress.get("inkGatherX") ?? GATHER_TARGET[0],
  progress.get("inkGatherY") ?? GATHER_TARGET[1],
];
```

并透传到 `step(...)` → `applyGather(gl, gather, dt, gatherTarget)`。GATHER_TARGET 保留作缺省（序幕行为不变）。

- [ ] **Step 3: ZoomThroughTransition 重写**

```tsx
export function ZoomThroughTransition() {
  const p = useSceneProgress("dive");
  const chapter = useSceneProgress("manifesto");
  const { engine, status, setTakeover } = useCinema();
  const feedFluid = (dive: number, manifesto: number) => {
    // 墨潮回灌:dive 末 8% 内 0->1;可见窗覆盖回灌段与 manifesto 前 10%
    engine?.setProgress("fluidP", Math.max(0, (dive - 0.92) / 0.08));
    const on = dive > 0.92 && (dive < 1 || manifesto < 0.1);
    engine?.setProgress("fluidVisible", on ? 1 : 0);
  };
  useMotionValueEvent(p, "change", (v) => {
    if (engine) setTakeover(v > 0.001 && v < 0.999);
    const landscapeOff =
      !engine ||
      !engine.hasPass("landscape") ||
      engine.isDisabled("landscape");
    if (landscapeOff) {
      // 回退:2.5D dolly 全程(landscape 缺失/被熔断/无引擎)
      const dv = Math.min(1, v / 0.92);
      engine?.setProgress("dollyVisible", v > 0.001 && v < 0.92 ? 1 : 0);
      engine?.setProgress("dollyZoom", 1 + easeIn(dv) * 17);
      engine?.setProgress("dollySmear", 1 - Math.abs(dv * 2 - 1));
      engine?.setProgress("dollyDark", Math.max(0, (v - 0.7) / 0.22));
      engine?.setProgress("landscapeVisible", 0);
      engine?.setProgress("inkFade", 0);
      engine?.setProgress("inkGather", 0);
    } else {
      const seg = (a: number, b: number) =>
        Math.max(0, Math.min(1, (v - a) / (b - a)));
      // dolly 推轨段(暖光纤维隧道收束,不压暗——交接给白雾)
      const dv = seg(0, 0.28);
      engine?.setProgress("dollyVisible", v > 0.001 && v < 0.3 ? 1 : 0);
      engine?.setProgress("dollyZoom", 1 + easeIn(dv) * 17);
      engine?.setProgress("dollySmear", 1 - Math.abs(dv * 2 - 1));
      engine?.setProgress("dollyDark", 0);
      // 墨坠成山:活墨向谷底聚拢,山形自白雾中隆起
      const inkBell = seg(0.25, 0.36) * (1 - seg(0.44, 0.55));
      engine?.setProgress("inkFade", inkBell * 0.85);
      engine?.setProgress("inkGather", v > 0.25 && v < 0.5 ? 1 : 0);
      engine?.setProgress("inkGatherX", 0.5);
      engine?.setProgress("inkGatherY", 0.9);
      // 飞越与雾:自全白显形,中段雾退,末端白场
      const on = v > 0.28 && v < 0.97;
      engine?.setProgress("landscapeVisible", on ? 1 : 0);
      engine?.setProgress("landscapeP", seg(0.3, 0.92));
      engine?.setProgress("landscapeRise", seg(0.28, 0.45));
      const fogOut = 1 - seg(0.3, 0.55) * 0.88;
      const fogIn = seg(0.85, 0.95);
      engine?.setProgress("landscapeFog", Math.max(fogOut, fogIn));
    }
    feedFluid(v, chapter.get());
  });
  useMotionValueEvent(chapter, "change", (v) => {
    feedFluid(p.get(), v);
  });
  if (status !== "full") return <LiteZoomThrough progress={p} />;
  return null;
}
```

（`hasPass/isDisabled` 已由 Task 4 Step 0 在 engine 落地；`isDisabled` 的真实熔断状态由 Task 10 接入。）

文件头注释同步更新（转场 A 的叙事：推轨 → 墨坠成山 → 飞越 → 白场 → 墨潮接墨章）。

- [ ] **Step 4: typecheck + lint + cinema 测试 + 目检**

```bash
pnpm --filter @repo/web exec tsc --noEmit
pnpm --filter @repo/web exec biome lint src/features/marketing/components/cinema/
pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/
pnpm --filter @repo/web dev   # 后台;走查 dive 五段(0.15/0.35/0.6/0.9/0.97)截图
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(marketing): dive 扩为入画飞越——墨坠成山/谷道穿行/白场接墨章"
```

---

### Task 6: 墨池真倒影 + 焦散（gl/passes/pool.ts）

**Files:**
- Modify: `apps/web/src/features/marketing/components/cinema/cinema-geometry.ts`（导出 STRIP_* 常量）
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/pool-cell.ts`（TS 镜像纯函数）
- Test: `apps/web/src/features/marketing/components/cinema/gl/passes/pool-cell.test.ts`
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/pool.ts`
- Modify: `apps/web/src/features/marketing/components/cinema/cinema-film.tsx`（图集构建与注册）
- Modify: `apps/web/src/features/marketing/components/cinema/scene-wall.tsx`（PoolDirector 喂键 + full 态隐去 DOM 倒影）

- [ ] **Step 1: 导出展墙常量 + 写 pool-cell 纯函数与测试**

`cinema-geometry.ts`：把 `STRIP_H/STRIP_W/STRIP_GAP/STRIP_STAGGER/STRIP_WHISPER_W` 改为 export（值不变）。

`pool-cell.ts`（GLSL 轨道映射的 TS 镜像，两者须数值一致）：

```ts
/**
 * 墨池倒影的轨道映射:屏幕横坐标 -> 展墙轨道格序与格内 uv。
 * GLSL(pool.ts)与本文件是同一映射的两个实现,改动须双同步。
 */
import {
  STRIP_GAP,
  STRIP_STAGGER,
  STRIP_W,
  STRIP_WHISPER_W,
} from "../cinema-geometry";

export interface PoolCell {
  /** 格序;-1 = 缝/低语栏位(水面无画) */
  index: number;
  /** 格内横坐标 [0,1] */
  u: number;
  /** 奇偶交错(0 偶 / 1 奇):各格有自己的水线 */
  parity: 0 | 1;
}

/**
 * trackX 为轨道系横坐标(视口宽分数,含 glide 位移后的复原)。
 * whisperAfter 为插有低语栏位的格序;迭代 3 次收敛
 * (低语栏位使后续格右移,格序又决定栏位数,互为因果)。
 */
export function poolCellAt(
  trackX: number,
  count: number,
  whisperAfter: readonly number[]
): PoolCell {
  const pitch = STRIP_W + STRIP_GAP;
  let index = Math.floor((trackX - STRIP_GAP) / pitch);
  for (let k = 0; k < 3; k++) {
    const whispers = whisperAfter.filter((a) => a < index).length;
    index = Math.floor(
      (trackX - STRIP_GAP - whispers * STRIP_WHISPER_W) / pitch
    );
  }
  if (index < 0 || index >= count) return { index: -1, u: 0, parity: 0 };
  const whispers = whisperAfter.filter((a) => a < index).length;
  const cellX =
    STRIP_GAP + index * pitch + whispers * STRIP_WHISPER_W;
  const u = (trackX - cellX) / STRIP_W;
  if (u < 0 || u > 1) return { index: -1, u: 0, parity: 0 };
  return { index, u, parity: index % 2 === 0 ? 0 : 1 };
}

/** 各格水线(视口高分数):偶格与展厅地面线齐,奇格低 2*STAGGER */
export function poolWaterY(parity: 0 | 1, baseWaterY: number): number {
  return baseWaterY + parity * 2 * STRIP_STAGGER;
}
```

测试（pool-cell.test.ts）：首格/末格命中、缝返回 -1、低语栏位后格序右移收敛（trackX 取 cell5 中心，WHISPER_AFTER=[3,8,12] 时应返回 5）、水线奇偶差 0.09。

- [ ] **Step 2: 实现 pool.ts**

```ts
/**
 * 墨池 pass(v1.2 奇观二):展墙画作映上真水面。
 * 倒影 = 图集垂直镜像重采样 + 解析波面扭曲(波幅随滚动速度)+
 * 光标涟漪;焦散 = 迭代式程序化光网(单色,<=0.08,tier>=2 才绘)。
 * 轨道映射 GLSL 与 pool-cell.ts 双同步(改动必须两边一起)。
 * 读 progress 键:poolVisible(< 0.5 跳绘)/poolWaterY(地面线视口分数)/
 * poolGlide(展墙推轨 0-1)/poolTrackW(轨道总宽)/poolPhase(波动相位)/
 * scrollVel(速度加波幅)/pointer.x|y|speed(光标涟漪)。
 * cost: 2(熔断候选;被熔断时 scene-wall 恢复 DOM 倒影兜底)。
 */
import {
  type CinemaPass,
  compileProgram,
  createTexture,
  FULLSCREEN_VS,
  type PassContext,
} from "../engine";
import { INK_NOISE } from "../ink/chunks";

const FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform sampler2D uAtlas;
uniform float uWaterY;
uniform float uGlide;
uniform float uTrackW;
uniform float uPhase;
uniform float uVel;
uniform vec3 uPointer;
uniform float uTier;
out vec4 outColor;
${INK_NOISE}

const float STRIP_W = 0.36;
const float STRIP_GAP = 0.06;
const float STRIP_H = 0.52;
const float STAGGER = 0.045;
const float WHISPER_W = 0.16;
// WHISPER_AFTER = [3, 8, 12],与 scene-wall 同一事实
const int WHISPER[3] = int[3](3, 8, 12);

float caustic(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy / uSize;
  float sy = 1.0 - frag.y; // 视口分数,y 自顶向下
  if (sy < uWaterY || sy > uWaterY + STRIP_H * 0.5) {
    outColor = vec4(0.0);
    return;
  }
  float aspect = uSize.x / uSize.y;
  // 轨道映射全部在"视口宽分数"系内进行(与 pool-cell.ts/stripPos
  // 同一单位):屏幕 x + 推轨位移复原;aspect 只用于 cover 裁切与
  // 圆形涟漪的物理等距
  float trackX = frag.x + uGlide * (uTrackW - 1.0);
  // 格序迭代收敛(与 pool-cell.ts 同算法)
  float pitch = STRIP_W + STRIP_GAP;
  int index = int(floor((trackX - STRIP_GAP) / pitch));
  for (int k = 0; k < 3; k++) {
    int wh = 0;
    for (int q = 0; q < 3; q++) {
      if (WHISPER[q] < index) wh++;
    }
    index = int(floor((trackX - STRIP_GAP - float(wh) * WHISPER_W) / pitch));
  }
  float parity = float(index - (index / 2) * 2);
  float cellWaterY = uWaterY + parity * 2.0 * STAGGER;
  float d = sy - cellWaterY; // 入水深度(视口高分数)
  vec3 col = vec3(0.05, 0.05, 0.048); // 墨池本色
  float alpha = 0.0;
  if (d > 0.0 && index >= 0 && index < 16) {
    int wh = 0;
    for (int q = 0; q < 3; q++) {
      if (WHISPER[q] < index) wh++;
    }
    float cellX = STRIP_GAP + float(index) * pitch + float(wh) * WHISPER_W;
    float u = (trackX - cellX) / STRIP_W;
    if (u >= 0.0 && u <= 1.0) {
      // 波面扭曲:深度越深晃越多;速度加波幅;光标涟漪
      float wob = 0.0035 + uVel * 0.008 + d * 0.02;
      vec2 ripple = vec2(
        sin(d * 46.0 + uPhase * 6.28) + sin(trackX * 34.0 - uPhase * 4.0),
        cos(trackX * 28.0 + uPhase * 5.1)
      ) * wob;
      // 圆形涟漪:x 以 aspect 加权恢复物理等距(pointer 键为宽分数)
      vec2 pdv = vec2((frag.x - uPointer.x) * aspect, sy - uPointer.y);
      float pd = length(pdv);
      ripple += vec2(sin(pd * 60.0 - uPhase * 18.0)) * exp(-pd * 12.0) * uPointer.z * 0.01;
      float ru = clamp(u + ripple.x, 0.0, 1.0);
      // 镜像翻转:水线处(d=0)映画底缘,深处映画高处
      float rv = clamp(1.0 - d / STRIP_H + ripple.y * 0.5, 0.0, 1.0);
      // 图集 4x4:格内 cover 裁切(画幅 0.36 宽 x 0.52 高,源图方形)
      float cellAspect = (STRIP_W * aspect) / STRIP_H;
      vec2 cellUv = vec2(ru, rv);
      if (cellAspect < 1.0) {
        cellUv.x = 0.5 + (ru - 0.5) * cellAspect;
      } else {
        cellUv.y = 0.5 + (rv - 0.5) / cellAspect;
      }
      vec2 atlasUv = (vec2(float(index - (index / 4) * 4), float(index / 4)) + cellUv) * 0.25;
      vec3 refl = texture(uAtlas, atlasUv).rgb;
      float fade = pow(max(0.0, 1.0 - d / (STRIP_H * 0.42)), 1.6);
      col = mix(col, refl * 0.62, fade * 0.55);
      alpha = fade * 0.5;
      // 焦散:水下光网(单色,克制 <=0.08;低档位不绘)
      if (uTier >= 2.0) {
        float ca = caustic(vec2(trackX * 4.0, d * 4.0), uPhase * 2.0);
        col += vec3(ca * 0.08) * fade;
        alpha = max(alpha, ca * 0.1 * fade);
      }
    }
  }
  outColor = vec4(col, alpha);
}`;

export function createPoolPass(atlas: TexImageSource): CinemaPass {
  let prog: WebGLProgram | null = null;
  let atlasTex: WebGLTexture | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const names = [
    "uSize",
    "uAtlas",
    "uWaterY",
    "uGlide",
    "uTrackW",
    "uPhase",
    "uVel",
    "uPointer",
    "uTier",
  ] as const;
  return {
    key: "pool",
    enabled: true,
    cost: 2,
    init(gl) {
      prog = compileProgram(gl, FULLSCREEN_VS, FS);
      atlasTex = createTexture(gl, atlas);
      for (const name of names) {
        loc[name] = gl.getUniformLocation(prog, name);
      }
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!prog || !atlasTex) return;
      if ((progress.get("poolVisible") ?? 0) < 0.5) return;
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(loc.uAtlas ?? null, 0);
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(loc.uWaterY ?? null, progress.get("poolWaterY") ?? 0.8);
      gl.uniform1f(loc.uGlide ?? null, progress.get("poolGlide") ?? 0);
      gl.uniform1f(loc.uTrackW ?? null, progress.get("poolTrackW") ?? 7.5);
      gl.uniform1f(loc.uPhase ?? null, progress.get("poolPhase") ?? 0);
      gl.uniform1f(loc.uVel ?? null, progress.get("scrollVel") ?? 0);
      gl.uniform3f(
        loc.uPointer ?? null,
        progress.get("pointer.x") ?? -1,
        progress.get("pointer.y") ?? -1,
        progress.get("pointer.speed") ?? 0
      );
      gl.uniform1f(loc.uTier ?? null, ctx.tier);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      if (atlasTex) gl.deleteTexture(atlasTex);
      prog = null;
      atlasTex = null;
    },
  };
}
```

坐标约定：`sy = 1.0 - frag.y` 转视口分数 y 自顶向下，与 DOM/pointer 键同系；轨道映射全程在视口宽分数系（与 stripPos/pool-cell.ts 同单位），aspect 仅用于 cover 裁切与圆形涟漪的物理等距。

- [ ] **Step 3: cinema-film.tsx 构建图集并注册（particles 之后）**

```ts
// WALL_CELL_SRCS 16 张解码后拼 2048x2048 图集(4x4,每格 512)
const atlasReady = Promise.all(WALL_CELL_SRCS.map(loadImage)).then((imgs) => {
  const ok = imgs.filter((i): i is HTMLImageElement => i !== null);
  if (ok.length < 16) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 2048;
  const g = canvas.getContext("2d");
  if (!g) return null;
  ok.forEach((img, i) => {
    g.drawImage(img, (i % 4) * 512, Math.floor(i / 4) * 512, 512, 512);
  });
  return canvas;
});
// 注册:
if (atlas) engine.addPass(createPoolPass(atlas));
```

import：`import { WALL_CELL_SRCS } from "./cinema-artworks";`、`import { createPoolPass } from "./gl/passes/pool";`。

- [ ] **Step 4: scene-wall.tsx 接线**

新增 PoolDirector（挂在 WallScene 内，full 态才渲染）：

```tsx
function PoolDirector({ vw, vh }: { vw: number; vh: number }) {
  const master = useMaster();
  const { engine, status } = useCinema();
  useMotionValueEvent(master, "change", (m) => {
    if (!engine || status !== "full") return;
    const wallP = sceneProgress(m, "wall");
    const { spread, glide } = wallPhases(wallP);
    const pick = pickReturn(sceneProgress(m, "pick"));
    const vis = spread * (1 - pick);
    const strip = wallStrip(0, vw, vh);
    const trackW = wallStrip(15, vw, vh).trackWidth;
    engine.setProgress("poolVisible", vis > 0.02 && !engine.isDisabled("pool") ? 1 : 0);
    engine.setProgress("poolWaterY", strip.y + strip.h);
    engine.setProgress("poolGlide", glide);
    engine.setProgress("poolTrackW", trackW);
    engine.setProgress("poolPhase", wallP);
  });
  return null;
}
```

WallFigure 的 DOM 倒影 `mirrorOpacity` 改：`full 且 pool 未熔断 -> 0`（GL 接管），否则原值——`useTransform(master, (m) => { if (status === "full" && !engine?.isDisabled("pool")) return 0; return plaqueOpacity 原逻辑; })`，`status/engine` 经 `useCinema()` 取。

- [ ] **Step 5: typecheck + lint + 测试 + 目检展墙段（glide 全程倒影跟画、焦散、光标涟漪）**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(marketing): 展墙墨池真倒影与焦散——图集镜像/波面扭曲/光标涟漪"
```

---

### Task 7: 笔触浮雕 + 迎光透纸（gl/passes/relief.ts）

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/relief.ts`
- Modify: `apps/web/src/features/marketing/components/cinema/cinema-film.tsx`（注册，revise overlay 之后）
- Modify: `apps/web/src/features/marketing/components/cinema/scene-generate.tsx`（macro 段喂键，与 denoise 互斥）

- [ ] **Step 1: 实现 relief.ts**

```ts
/**
 * 笔触浮雕 pass(v1.2 奇观三):macro 凝视段画布的物质化。
 * hero 深度图 Sobel 求法线,掠射光角随滚动缓转——浓墨堆起、
 * 飞白露纸纤维;迎光窗口光源移到画后,薄处透光(paperGlow,
 * "这是纸,不是屏幕"的直接论据)。只画 canvasRect 区域(与 denoise
 * 互斥:reliefVisible=1 时 GenerateScene 把 denoiseVisible 喂 0)。
 * 读 progress 键:reliefVisible(< 0.5 跳绘)/canvasRect.x|y|w|h/
 * canvasCrop.x|y|z(与 denoise 同一取景窗)/reliefLight(光角弧度)/
 * reliefBack(0-1 迎光强度)。cost: 1(熔断候选)。
 */
import {
  type CinemaPass,
  compileProgram,
  createTexture,
  FULLSCREEN_VS,
  type PassContext,
} from "../engine";
import { HEIGHT_NORMAL, INK_NOISE, PAPER_GLOW } from "../ink/chunks";

const FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec4 uRect;
uniform vec3 uCrop;
uniform float uLight;
uniform float uBack;
out vec4 outColor;
${INK_NOISE}
${HEIGHT_NORMAL}
${PAPER_GLOW}
void main() {
  vec2 frag = gl_FragCoord.xy / uSize;
  vec2 uv = vec2(frag.x, 1.0 - frag.y);
  vec2 local = (uv - uRect.xy) / uRect.zw;
  if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  vec2 sampleUv = uCrop.xy + (local - 0.5) * uCrop.z;
  vec4 texel = texture(uImage, sampleUv);
  float texLum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  float depth = texture(uDepth, sampleUv).r;
  // hero 深度图为 1024x1024;Sobel 步长随取景窗缩放(微距下仍跨 texel)
  vec2 texelSize = vec2(uCrop.z / 1024.0);
  vec3 n = heightNormal(uDepth, sampleUv, texelSize, 6.0);
  // 掠射光:低角度扫过纸面,墨的堆叠感来自长影
  vec3 lightDir = normalize(vec3(cos(uLight), sin(uLight), 0.55));
  float lambert = max(dot(n, lightDir), 0.0);
  float spec = pow(max(dot(n, normalize(lightDir + vec3(0.0, 0.0, 1.0))), 0.0), 24.0);
  float inkAmt = 1.0 - smoothstep(0.5, 0.9, texLum);
  vec3 col = texel.rgb * (0.8 + lambert * 0.3);
  col += vec3(1.0, 0.99, 0.96) * spec * 0.12 * inkAmt;
  // 迎光一拍:薄处透光(纸的物质证词)
  float glow = paperGlow(depth, uBack);
  col += vec3(1.0, 0.985, 0.94) * glow * 0.3;
  // 边缘随取景收窄入焦外(与 denoise 的 DOF 同一语言)
  float soft = length(local - 0.5) * (1.0 - uCrop.z) * 0.007;
  vec3 blurred = (col
    + texture(uImage, sampleUv + vec2(soft, soft * 0.6)).rgb
    + texture(uImage, sampleUv + vec2(-soft, soft)).rgb) / 3.0;
  col = mix(col, blurred, clamp(soft * 400.0, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}`;

export function createReliefPass(
  image: TexImageSource,
  depth: TexImageSource
): CinemaPass {
  let prog: WebGLProgram | null = null;
  let imageTex: WebGLTexture | null = null;
  let depthTex: WebGLTexture | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const names = [
    "uSize",
    "uImage",
    "uDepth",
    "uRect",
    "uCrop",
    "uLight",
    "uBack",
  ] as const;
  return {
    key: "relief",
    enabled: true,
    cost: 1,
    init(gl) {
      prog = compileProgram(gl, FULLSCREEN_VS, FS);
      imageTex = createTexture(gl, image);
      depthTex = createTexture(gl, depth);
      for (const name of names) {
        loc[name] = gl.getUniformLocation(prog, name);
      }
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!prog || !imageTex || !depthTex) return;
      if ((progress.get("reliefVisible") ?? 0) < 0.5) return;
      const w = progress.get("canvasRect.w") ?? 0;
      if (w <= 0) return;
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, imageTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.uniform1i(loc.uImage ?? null, 0);
      gl.uniform1i(loc.uDepth ?? null, 1);
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform4f(
        loc.uRect ?? null,
        progress.get("canvasRect.x") ?? 0,
        progress.get("canvasRect.y") ?? 0,
        w,
        progress.get("canvasRect.h") ?? 0
      );
      gl.uniform3f(
        loc.uCrop ?? null,
        progress.get("canvasCrop.x") ?? 0.5,
        progress.get("canvasCrop.y") ?? 0.5,
        progress.get("canvasCrop.z") ?? 1
      );
      gl.uniform1f(loc.uLight ?? null, progress.get("reliefLight") ?? 0.8);
      gl.uniform1f(loc.uBack ?? null, progress.get("reliefBack") ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      if (imageTex) gl.deleteTexture(imageTex);
      if (depthTex) gl.deleteTexture(depthTex);
      prog = null;
      imageTex = null;
      depthTex = null;
    },
  };
}
```

- [ ] **Step 2: cinema-film.tsx 注册**

`if (art && dep) engine.addPass(createReliefPass(art, dep));`（紧跟 revise overlay 之后、dolly 之前；art/dep 已加载，零新资产）。

- [ ] **Step 3: scene-generate.tsx macro 段喂键**

GenerateScene 的 master change 处理器内（喂 canvasCrop 之后）追加：

```ts
// 浮雕接管:macro 推近完成后(0.3)到拉回交棒 dive(0.95)之间,
// relief 替代 denoise 绘制同一画布矩形(互斥,零交接跳变)
const reliefOn = mac > 0.3 && mac < 0.95 ? 1 : 0;
engine?.setProgress("reliefVisible", reliefOn);
engine?.setProgress("reliefLight", 0.8 + mac * 1.9);
// 迎光一拍:驻留段中光源移到画后,薄处透光
const back = bell(Math.max(0, Math.min(1, (mac - 0.5) / 0.3)));
engine?.setProgress("reliefBack", back * 0.8);
```

并把既有 `denoiseVisible` 一行改为互斥：

```ts
engine?.setProgress("denoiseVisible", g > 0 && d < 0.05 && !(mac > 0.3 && mac < 0.95) ? 1 : 0);
```

- [ ] **Step 4: typecheck + lint + 目检 macro（浮雕扫光/迎光/与 denoise 交接帧无跳变）**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(marketing): macro 笔触浮雕与迎光透纸——浓墨堆起,薄处透光"
```

---

### Task 8: 光标抚墨（interaction/pointer.ts + 三路分发）

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/interaction/pointer.ts`
- Modify: `apps/web/src/features/marketing/components/cinema/cinema-film.tsx`（挂载 PointerFeed）
- Modify: `apps/web/src/features/marketing/components/cinema/gl/passes/fluid.ts`（指针 splat）
- Modify: `apps/web/src/features/marketing/components/cinema/gl/passes/particles.ts`（morph 趋避）

pool 涟漪已在 Task 6 消费 pointer 键。

- [ ] **Step 1: 实现 pointer.ts**

```ts
/**
 * 指针注入:光标位置/速度喂引擎键,供流体/粒子/墨池三路消费。
 * 只在指针移动帧出帧(静止零成本);速度经 EMA 平滑并衰减,
 * touch 设备无 pointermove 自然静默。全部键:y 自顶向下视口分数。
 */
import { useEffect } from "react";
import { useCinema } from "../cinema-gl";

export function PointerFeed(): null {
  const { engine, status } = useCinema();
  useEffect(() => {
    if (!engine || status !== "full") return;
    let x = 0.5;
    let y = 0.5;
    let vx = 0;
    let vy = 0;
    let lastT = 0;
    let raf: number | null = null;
    const tick = () => {
      raf = null;
      vx *= 0.86;
      vy *= 0.86;
      const speed = Math.min(1, Math.hypot(vx, vy));
      engine.setProgress("pointer.x", x);
      engine.setProgress("pointer.y", y);
      engine.setProgress("pointer.vx", vx);
      engine.setProgress("pointer.vy", vy);
      engine.setProgress("pointer.angle", Math.atan2(vy, vx));
      engine.setProgress("pointer.speed", speed);
      if (speed > 0.015) raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth;
      const ny = e.clientY / window.innerHeight;
      const now = performance.now();
      const dt = Math.max(8, now - lastT) / 1000;
      lastT = now;
      vx = vx * 0.6 + ((nx - x) / dt) * 0.06;
      vy = vy * 0.6 + ((ny - y) / dt) * 0.06;
      x = nx;
      y = ny;
      if (raf === null) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [engine, status]);
  return null;
}
```

`useCinema` 在 provider 内可用；`PointerFeed` 挂在 FilmBody 的 full/lite 分支内（CinemaStage 子树即可——它不依赖 master）。useEffect 依赖 `useCinema` 返回的 engine/status，full 才启动。注意 `PointerFeed` 是组件所以必须在 cinema-film.tsx 里以 `<PointerFeed />` 挂载（放在 `<HeaderDimmer />` 旁）。

- [ ] **Step 2: fluid.ts 指针 splat**

`step` 签名加 `pointer: { x: number; y: number; angle: number; speed: number }`；在检查点脉冲循环之后、活墨渗出之前插入：

```ts
// 光标抚墨:指针速度注入速度场(两模式皆响应),活墨模式附带
// 淡墨拖尾;dt 定标与 seep 同纲,能量下限保持出帧
if (pointer.speed > 0.03) {
  const pp: PulseDef = {
    at: 0,
    angle0: pointer.angle,
    strength: pointer.speed * 0.5 * dt,
    dye: mode === 2 ? pointer.speed * 0.2 * dt : 0,
    radius: 0.0032,
  };
  const center: readonly [number, number] = [pointer.x, pointer.y];
  splat(gl, velocity, 0, pp, center, 0.02);
  if (mode === 2) splat(gl, dye, 1, pp, center, 0.02);
  energy = Math.max(energy, 0.25);
}
```

`render` 读取键并透传：

```ts
const pointer = {
  x: progress.get("pointer.x") ?? 0.5,
  y: progress.get("pointer.y") ?? 0.5,
  angle: progress.get("pointer.angle") ?? 0,
  speed: progress.get("pointer.speed") ?? 0,
};
// step(gl, p, dtMs / 1000, ctx.tier, mode, lastGather, gatherTarget, pointer);
```

- [ ] **Step 3: particles.ts morph 趋避**

VS uniforms 加 `uniform vec3 uPointer;`，morph 分支末尾（`pos = base + wander;` 之后）：

```glsl
// 光标趋避:温柔斥力,只作用途中粒子(bellP 加权,轮廓段为零)
vec2 away = pos - uPointer.xy;
float pd = length(away);
float push = smoothstep(0.09, 0.0, pd) * uPointer.z * bellP;
pos += (away / max(pd, 1e-3)) * push * 0.03;
```

render() 读取并喂：`uPointer = (pointer.x, pointer.y, pointer.speed)`（pointer.x 缺省 -2 屏外）。names 数组加 `"uPointer"`。

- [ ] **Step 4: typecheck + lint + 目检（序幕拨墨/增殖趋避/墨池涟漪）**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(marketing): 光标抚墨——流体拨墨/粒子趋避/墨池涟漪三路分发"
```

---

### Task 9: 镜头签名（CameraFeelDirector + post/dolly/landscape 消费）

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/camera-feel.tsx`
- Modify: `apps/web/src/features/marketing/components/cinema/cinema-film.tsx`（挂载）
- Modify: `apps/web/src/features/marketing/components/cinema/gl/passes/post.ts`（速度颗粒拉丝 + 片门微颤）
- Modify: `apps/web/src/features/marketing/components/cinema/gl/passes/dolly.ts`（速度拖影）

landscape 的手持/跟焦/速度雾已在 Task 4 内建（读 handX/handY/focusDepth/scrollVel 键）。

- [ ] **Step 1: 实现 camera-feel.tsx**

```tsx
"use client";

/**
 * 镜头签名编排:滚动速度/手持呼吸/跟焦平面三键的全片单一事实源。
 * 速度 = useVelocity(master) 归一;手持 = 低频双正弦叠加(纹理层,
 * 只在出帧时更新,静止零成本);跟焦 = 按幕分段的目标焦平面
 * (macro 近 0.3 / 飞越中 0.65 / 其余 0.5),pass 内自行平滑。
 */
import { useMotionValueEvent, useVelocity } from "framer-motion";
import { sceneProgress } from "./cinema-config";
import { useCinema } from "./cinema-gl";
import { useMaster } from "./cinema-stage";

export function CameraFeelDirector(): null {
  const master = useMaster();
  const { engine } = useCinema();
  const vel = useVelocity(master);
  useMotionValueEvent(vel, "change", (v) => {
    engine?.setProgress("scrollVel", Math.min(1, Math.abs(v) * 0.55));
    const t = performance.now() * 0.0004;
    engine?.setProgress("handX", Math.sin(t * 1.7) + Math.sin(t * 2.9) * 0.5);
    engine?.setProgress("handY", Math.cos(t * 1.3) + Math.sin(t * 2.3) * 0.5);
  });
  useMotionValueEvent(master, "change", (m) => {
    const mac = sceneProgress(m, "macro");
    const dv = sceneProgress(m, "dive");
    const focus =
      mac > 0.15 && mac < 0.98 ? 0.3 : dv > 0.3 && dv < 0.95 ? 0.65 : 0.5;
    engine?.setProgress("focusDepth", focus);
  });
  return null;
}
```

挂载于 FilmBody 的 CinemaStage 子树（`<InkMistDirector />` 旁）。

- [ ] **Step 2: post.ts 速度颗粒拉丝 + 片门微颤**

FS uniforms 加 `uVel`、`uWeave`；main 开头：

```glsl
vec2 uv = gl_FragCoord.xy / uSize;
// 片门微颤:亚像素机位抖(仅 tier>=2 喂值;罩纹随画面同抖)
vec2 wob = vec2(
  vnoise(vec2(uTime * 0.00021, 3.7)),
  vnoise(vec2(uTime * 0.00017, 9.1))
) - 0.5;
uv += wob * uWeave;
```

颗粒行改为速度拉丝（快滚时 IGN 纵向压缩成丝——胶片速度的触觉）：

```glsl
float g = ign(vec2(
  gl_FragCoord.x,
  gl_FragCoord.y / (1.0 + uVel * 5.0)
) + vec2(mod(uTime * 0.06, 64.0)));
```

掠光亮度随速度微提（`lightA` 加 `uVel * 0.02`）。render 喂：`uVel = scrollVel`，`uWeave = tier >= 2 ? 0.0012 : 0`。

- [ ] **Step 3: dolly.ts 速度拖影**

render 中 `uSmear` 取值改为与速度键取大：

```ts
gl.uniform1f(
  loc.uSmear ?? null,
  Math.max(
    progress.get("dollySmear") ?? 0,
    (progress.get("scrollVel") ?? 0) * 0.6
  )
);
```

- [ ] **Step 4: typecheck + lint + 目检（快滚拉丝/停稳回弹/手持仅满档）**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(marketing): 镜头签名——速度拖影/颗粒拉丝/手持呼吸/跟焦平面"
```

---

### Task 10: 单项熔断 + 质量档细分 + 走查收口

**Files:**
- Modify: `apps/web/src/features/marketing/components/cinema/gl/engine.ts`（per-pass 计时 EMA + 熔断/恢复）
- Modify: `apps/web/src/features/marketing/components/cinema/gl/quality.ts`（pickBreakerVictim 纯函数）
- Test: `apps/web/src/features/marketing/components/cinema/gl/quality.test.ts`（追加）
- Modify: `apps/web/src/features/marketing/components/cinema/transitions.tsx`（isDisabled 占位换真实）
- Docs: `docs/plan/2026-07-23-homepage-cinema-v12-design.md`（完成情况）、`docs/MEMORY.md`、`docs/TODO.md`

- [ ] **Step 1: pickBreakerVictim 纯函数与测试**

quality.ts 追加：

```ts
/**
 * 单项熔断候选挑选:降档时先牺牲"贵且可缺"的单个 pass,
 * 而非整档跳变(观感损失最小化)。返回最高耗时 EMA 的候选 key;
 * 无候选返回 null。纯函数,可单测。
 */
export function pickBreakerVictim(
  candidates: readonly { key: string; cost: number; emaMs: number }[]
): string | null {
  let best: string | null = null;
  let bestMs = -1;
  for (const c of candidates) {
    if (c.cost <= 0) continue;
    if (c.emaMs > bestMs) {
      bestMs = c.emaMs;
      best = c.key;
    }
  }
  return best;
}
```

测试：空表 null、全零 cost null、取最高 ema、并列取先出现者。

- [ ] **Step 2: engine.ts 熔断实现**

`CinemaPass` 接口已有 `cost?: number`（Task 4 Step 0）。engine 私有字段加：

```ts
private passEma = new Map<string, number>();
private breakerStack: string[] = [];
private lastTier: QualityTier = 2;
```

`frame` 的 pass 循环改：

```ts
for (const p of this.passes) {
  if (!p.enabled) continue;
  const t0 = performance.now();
  p.render(ctx);
  const dt = performance.now() - t0;
  this.passEma.set(p.key, (this.passEma.get(p.key) ?? dt) * 0.9 + dt * 0.1);
  if (p.isLive?.()) live = true;
}
// 熔断:降档发生时牺牲最贵候选;升档恢复(后进先出)
if (tier < this.lastTier) {
  const victim = pickBreakerVictim(
    this.passes
      .filter((p) => p.enabled && (p.cost ?? 0) > 0)
      .map((p) => ({
        key: p.key,
        cost: p.cost ?? 0,
        emaMs: this.passEma.get(p.key) ?? 0,
      }))
  );
  if (victim) {
    const pass = this.passes.find((p) => p.key === victim);
    if (pass) pass.enabled = false;
    this.breakerStack.push(victim);
  }
} else if (tier > this.lastTier && this.breakerStack.length > 0) {
  const key = this.breakerStack.pop();
  const pass = this.passes.find((p) => p.key === key);
  if (pass) pass.enabled = true;
}
this.lastTier = tier;
```

公开方法：

```ts
hasPass(key: string): boolean {
  return this.passes.some((p) => p.key === key);
}

isDisabled(key: string): boolean {
  return this.breakerStack.includes(key);
}
```

（Task 4/5 的占位实现以本任务为准合并；性能纪律：per-pass 计时是 CPU 侧近似——GPU 异步，但相对贵廉信号稳定，足够熔断决策。注释写明 WHY。）

- [ ] **Step 3: 全门禁 + 三层走查**

```bash
pnpm --filter @repo/web exec tsc --noEmit
pnpm --filter @repo/web exec biome lint src/features/marketing/components/cinema/
pnpm --filter @repo/web test
pnpm build
```

走查（playwright，dev server 后台）：dive 五段截图（v=0.15 dolly 隧道 / 0.35 墨坠 / 0.6 谷中 / 0.9 雾出 / 0.97 墨潮）、macro 浮雕与迎光、展墙 glide 三段倒影+焦散+光标拨开墨、快滚拉丝；倒放（谷底滚回序幕）无残态；`?gl=static` 与 `?gl=lite` 回退层完整可读；窄屏 390px 静态编排。

- [ ] **Step 4: 文档收口**

设计稿追加「十一、完成情况」节（门禁记录与走查记录、新增勘误）；MEMORY.md 索引加一行；TODO.md 首页影片化节勾销本轮项、登记新后置项（真实扩散帧序列资产等仍未做项保持）。

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "feat(marketing): v1.2 单项熔断与质量档细分,走查收口"
git push origin main
```

---

## 实施顺序与依赖

```
Task 1(素材) ─┐
Task 2(chunks) ─┼─> Task 4(landscape) ─> Task 5(dive 编排)
Task 3(样条) ──┘
Task 2 ─> Task 6(pool) ─┐
Task 2 ─> Task 7(relief) ─┤
                          ├─> Task 8(pointer) ─> Task 9(镜头) ─> Task 10(熔断+收口)
```

Task 1 可与 2/3 并行；Task 6/7 互不依赖可并行；Task 10 必须最后。

## 风险与回退

- **landscape 资产缺失/生成失败**：dive 自动全程 dolly 兜底（hasPass 分支），可独立上线其余奇观。
- **熔断误杀**：breakerStack 升档即恢复；走查期可在 DevTools 观察 console（熔断时 `console.info` 记录——实现时补一行）。
- **pool 倒影错位**（轨道映射 GLSL/TS 漂移）：pool-cell 单测锁映射；走查核对 glide=1 时末格倒影对位。
- **谷道穿模**：ingest 掩膜保证走廊高度 <= 25%；走查若仍擦山脊，调 landscape-path 的 cruise 高度或掩膜宽度，重跑 ingest 即可（纯资产层调整，零代码改动）。
