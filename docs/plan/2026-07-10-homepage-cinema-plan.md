# 首页影片化滚动「一次生成 + 墨线」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将首页重构为一部滚动驱动的影片：手写 WebGL2 摄影棚承载扩散显影/粒子/流体/2.5D 推轨等极致渲染，画布主角一镜到底，墨线全页衔接，三层回退保证可读性。

**Architecture:** DOM 承载全部真实内容（SEO），其上一层全屏固定 WebGL2 画布（动态导入、pointer-events-none），经 dom-sync 与 DOM 元素对位。framer-motion useScroll 产出主进度，经 cinema-config 纯函数切分为各幕窗口，喂入 GL uniform（不经 React 渲染）。场景组件 GL 无关化：读取 GLStatus 决定完整版/中端版表现，静态版为独立编排。

**Tech Stack:** Next.js 16 App Router、React 19、framer-motion ^12.40（营销 bundle 专用）、手写 WebGL2（零新依赖）、Tailwind v4、next-intl、Vitest。

**规格来源:** docs/plan/2026-07-10-homepage-cinema-design.md（v2 极致渲染版）。分镜、行程预算、回退阶梯以该文档为准。

**执行前置:** 后台 workflow wf_9730fd22-995（Reskin/Gates/Docs）落地并推送后再开始，避免构建门禁互相干扰。

## Global Constraints

- 注释一律简体中文；任何文件、提交信息、文案中永不使用 emoji。
- TypeScript strict，禁止 `any`（必要时 `unknown` + 收窄）；Biome 双引号、2 空格、行宽 80，提交前 lint 无 error。
- framer-motion 仅允许在营销 bundle 内 import（cinema 属营销）。
- framer-motion 12 两条铁律：useTransform 一律函数式回调；transform 类与 opacity 等普通样式 MotionValue 分层绑定到嵌套节点（memory: framer-motion-scroll-gotchas）。
- Tailwind v4：`translate-*`/`scale-*` 产出原生 CSS 属性，自定义过渡表必须写 `transition-[...,translate]`/`[...,scale]`，写 transform 无效。
- GL 纪律：单上下文、按需渲染、DPR 上限 1.5、IntersectionObserver 休眠、上下文丢失恢复。
- 所有既有 i18n key 保留使用；新增 key 仅允许 `Cinema` 命名空间（en.json 与 zh.json 同步）。
- 单分支 `main`，每个 Task 至少一次 Conventional Commit（正文写 WHY），不用 `--no-verify`。
- 提交前该 Task 相关验证通过；整计划收尾 `turbo typecheck && turbo lint && turbo test && turbo build` 全绿。
- 测试文件与被测模块同目录（`*.test.ts`），vitest DB-free，纯函数才可测——GL/DOM 代码中的可测逻辑必须抽为纯函数模块。

## 实施勘误（2026-07-11，Task 1-4 实施后回填）

1. **透明预乘画布的混合**：向 `premultipliedAlpha: true` 的透明画布做 alpha
   混合时，alpha 通道用 `SRC_ALPHA` 因子会得到 a*a（半透明强度被平方削弱，
   Task 3 像素级测量证实）。所有做混合的 pass（post/particles/fluid 合成）
   一律 `gl.blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`；
   不混合、直接整块输出的 pass（denoise/dolly，alpha 恒 1）不受影响。
2. **biome useHookAtTopLevel 误报**：pass 的 `render()` 内调用 `gl.useProgram`
   会被 biome 当作 React hook 误报，须行内
   `// biome-ignore lint/correctness/useHookAtTopLevel: WebGL API 非 React hook`。
3. **验收脚本滚动落点**：页面有 `scroll-behavior: smooth`，`browser_evaluate`
   执行 scrollTo 后必须轮询 `scrollTop` 稳定再读样式/截图，否则读到中途值。
4. **行程总长为 1550vh**（七幕之和；设计稿"约 1750vh"含终幕独立 200vh 舞台）。
   原文两处 1650 为算术笔误，已改。下游一律经 `filmTotalVh()` 派生，勿硬编码。
5. **SceneLayer 边界**：master=0（页面顶端）时 opening 层 opacity 为 0，
   序幕组件需自行处理首屏静置态（Task 6 落地时把 opening 窗口起点的可见性
   放宽为 `master <= window.start 时视为 p=极小正值`或首屏内容不依赖 SceneLayer
   透明度——以 Task 6 实施走查为准）。
6. **调控器空闲间隔误杀（Task 8 回填）**：按需渲染下引擎以
   `t - lastFrameAt` 采样帧耗时，滚动停顿后的首帧间隔是"多久没渲染"
   而非"渲染多慢"，一次数秒空闲会向 EMA 注入巨值并产生约 40 个虚假
   慢样本，数次停顿即把健康机器降到 0 档、watchdog 误杀 GL（Task 8
   验收实测）。已修：仅连续出帧（间隔 <= 250ms）才喂 governor，
   其余帧沿用当前档（engine.ts frame）。

## 文件结构总览

```
apps/web/src/features/marketing/components/cinema/
  cinema-config.ts          全片行程常量表 + 窗口纯函数（可单测）
  gl/engine.ts              WebGL2 迷你引擎（上下文/编译/纹理/按需渲染/丢失恢复）
  gl/quality.ts             质量调控器（纯逻辑，可单测）
  gl/dom-sync.ts            DOM rect -> 视口分数（纯函数可单测）+ 追踪器
  gl/passes/post.ts         胶片后处理（颗粒/晕影/halation）
  gl/passes/denoise.ts      蓝噪声(IGN)阈值扩散显影
  gl/passes/dolly.ts        2.5D 深度推轨 + 径向光痕
  gl/passes/fluid.ts        半分辨率 stable-fluids 墨模拟 + 覆盖遮罩
  gl/passes/particles.ts    实例化粒子（墨溅/溶解/布局 morph）
  cinema-gl.tsx             固定画布挂载 + 引擎生命周期 + GLStatus 探测阶梯
  cinema-stage.tsx          影片主舞台（1550vh 主进度）+ SceneWindow 原语
  scene-opening.tsx         序幕+第一幕（墨滴/标题显影/画布登场/prompt 打字）
  scene-generate.tsx        第二幕（去噪奇观/采样 HUD/解说词）
  scene-manifesto.tsx       第三幕（墨底宣言章节）
  scene-wall.tsx            第四幕（展墙横向推轨/观展低语）
  scene-finale.tsx          终幕（反向显影/bookend/CTA 内容）
  transitions.tsx           转场 A 穿越 / B 增殖 / C 选中回中
  ink-thread.tsx            墨线分段系统 + 章节刻度
  static-film.tsx           静态编排版（reduced-motion / <md / GL 全灭）
  index.ts                  桶导出
apps/web/src/app/[locale]/(marketing)/demo/cinema/page.tsx   联调预览路由
```

退役（Task 12）：`how-it-works.tsx`（四步文案转墨线刻度）、`testimonials.tsx`（评价转展墙低语）。

---

### Task 1: cinema-config 行程表与窗口纯函数

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/cinema-config.ts`
- Test: `apps/web/src/features/marketing/components/cinema/cinema-config.test.ts`

**Interfaces:**
- Produces: `FILM_SCENES`、`filmTotalVh(): number`、`sceneWindow(key): {start: number; end: number}`、`sceneProgress(master: number, key: SceneKey): number`、`bell(p: number): number`、`SceneKey` 类型。后续所有场景组件用它们把主进度切成幕内进度。

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/features/marketing/components/cinema/cinema-config.test.ts
// 影片行程表纯函数测试:窗口切分正确性与边界钳制。
import { describe, expect, it } from "vitest";
import {
  bell,
  FILM_SCENES,
  filmTotalVh,
  sceneProgress,
  sceneWindow,
} from "./cinema-config";

describe("cinema-config", () => {
  it("行程总长等于各幕之和", () => {
    const sum = FILM_SCENES.reduce((a, s) => a + s.lengthVh, 0);
    expect(filmTotalVh()).toBe(sum);
    expect(filmTotalVh()).toBe(1550);
  });

  it("窗口首尾相接且覆盖 [0,1]", () => {
    let cursor = 0;
    for (const s of FILM_SCENES) {
      const w = sceneWindow(s.key);
      expect(w.start).toBeCloseTo(cursor, 10);
      cursor = w.end;
    }
    expect(cursor).toBeCloseTo(1, 10);
  });

  it("幕内进度在窗口外钳制为 0/1,窗口内线性", () => {
    const w = sceneWindow("generate");
    expect(sceneProgress(w.start - 0.01, "generate")).toBe(0);
    expect(sceneProgress(w.end + 0.01, "generate")).toBe(1);
    const mid = (w.start + w.end) / 2;
    expect(sceneProgress(mid, "generate")).toBeCloseTo(0.5, 10);
  });

  it("bell 在 0/1 为 0,0.5 为 1,对称", () => {
    expect(bell(0)).toBe(0);
    expect(bell(1)).toBe(0);
    expect(bell(0.5)).toBe(1);
    expect(bell(0.25)).toBeCloseTo(bell(0.75), 10);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/cinema-config.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

```ts
// apps/web/src/features/marketing/components/cinema/cinema-config.ts
/**
 * 影片行程常量表与窗口纯函数。
 * 全片钉住段的唯一调参点:各幕 vh 预算改这里,窗口分数自动重算。
 * 纯函数无 DOM 依赖,供场景组件与单测共用。
 */

export type SceneKey =
  | "opening"
  | "generate"
  | "dive"
  | "manifesto"
  | "multiply"
  | "wall"
  | "pick";

export interface SceneDef {
  key: SceneKey;
  lengthVh: number;
}

/** 分镜行程预算(设计稿第四节);终幕独立 200vh 舞台不在此表 */
export const FILM_SCENES: readonly SceneDef[] = [
  { key: "opening", lengthVh: 200 },
  { key: "generate", lengthVh: 300 },
  { key: "dive", lengthVh: 150 },
  { key: "manifesto", lengthVh: 200 },
  { key: "multiply", lengthVh: 200 },
  { key: "wall", lengthVh: 400 },
  { key: "pick", lengthVh: 100 },
] as const;

export function filmTotalVh(scenes: readonly SceneDef[] = FILM_SCENES) {
  return scenes.reduce((acc, s) => acc + s.lengthVh, 0);
}

/** 幕在主进度 [0,1] 中的窗口分数 */
export function sceneWindow(
  key: SceneKey,
  scenes: readonly SceneDef[] = FILM_SCENES
): { start: number; end: number } {
  const total = filmTotalVh(scenes);
  let cursor = 0;
  for (const s of scenes) {
    const next = cursor + s.lengthVh / total;
    if (s.key === key) return { start: cursor, end: next };
    cursor = next;
  }
  throw new Error(`未知幕: ${key}`);
}

/** 主进度 -> 幕内进度(窗口外钳制) */
export function sceneProgress(master: number, key: SceneKey): number {
  const { start, end } = sceneWindow(key);
  if (master <= start) return 0;
  if (master >= end) return 1;
  return (master - start) / (end - start);
}

/** 0->1->0 的对称钟形,用于"途中量"(粒子扰动/光痕强度) */
export function bell(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return 1 - Math.abs(c * 2 - 1);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/cinema-config.test.ts`
Expected: PASS 4 tests。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/cinema-config.ts apps/web/src/features/marketing/components/cinema/cinema-config.test.ts
git commit -m "feat(web): cinema 影片行程表与窗口纯函数" -m "全片钉住行程单点调参;窗口切分为纯函数便于单测与场景组件复用。"
```

---

### Task 2: WebGL2 迷你引擎 + 质量调控器

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/engine.ts`
- Create: `apps/web/src/features/marketing/components/cinema/gl/quality.ts`
- Test: `apps/web/src/features/marketing/components/cinema/gl/quality.test.ts`

**Interfaces:**
- Produces:
  - `CinemaEngine.create(canvas: HTMLCanvasElement): CinemaEngine | null`（WebGL2 不可用返回 null，调用方走回退）
  - `engine.addPass(pass: CinemaPass): void`、`engine.setProgress(key: string, v: number): void`、`engine.setActive(active: boolean): void`、`engine.resize(): void`、`engine.dispose(): void`
  - `interface CinemaPass { key: string; init(gl: WebGL2RenderingContext): void; render(ctx: PassContext): void; dispose(gl: WebGL2RenderingContext): void; enabled: boolean }`
  - `interface PassContext { gl: WebGL2RenderingContext; timeMs: number; progress: ReadonlyMap<string, number>; width: number; height: number; tier: QualityTier }`
  - `compileProgram(gl, vsSource, fsSource): WebGLProgram`、`FULLSCREEN_VS: string`
  - `QualityGovernor`：`sample(frameMs: number): QualityTier`、`get tier(): QualityTier`；`type QualityTier = 0 | 1 | 2`（2 全效/1 降档/0 建议退出 GL）。

- [ ] **Step 1: 写质量调控器失败测试**

```ts
// apps/web/src/features/marketing/components/cinema/gl/quality.test.ts
// 质量调控器:EMA 帧耗时驱动的降/升档,含滞回防抖。
import { describe, expect, it } from "vitest";
import { QualityGovernor } from "./quality";

describe("QualityGovernor", () => {
  it("初始满档", () => {
    expect(new QualityGovernor().tier).toBe(2);
  });

  it("持续慢帧降档,一路降到 0", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 120; i++) g.sample(40);
    expect(g.tier).toBeLessThanOrEqual(1);
    for (let i = 0; i < 240; i++) g.sample(55);
    expect(g.tier).toBe(0);
  });

  it("快帧恢复,但需要滞回窗口(不会单帧反弹)", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 120; i++) g.sample(40);
    const dropped = g.tier;
    g.sample(8);
    expect(g.tier).toBe(dropped); // 单帧不升
    for (let i = 0; i < 300; i++) g.sample(8);
    expect(g.tier).toBeGreaterThan(dropped);
  });

  it("抖动帧(快慢交替)不震荡", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 400; i++) g.sample(i % 2 === 0 ? 10 : 34);
    // EMA 约 22ms,处于两阈值之间:应稳定停在某一档,而非来回跳
    const t1 = g.tier;
    for (let i = 0; i < 100; i++) g.sample(i % 2 === 0 ? 10 : 34);
    expect(g.tier).toBe(t1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/gl/quality.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 quality.ts**

```ts
// apps/web/src/features/marketing/components/cinema/gl/quality.ts
/**
 * 质量调控器:滚动出帧耗时的指数滑动平均驱动分档。
 * WHY 滞回:降档阈值(慢)与升档阈值(快)分开,且升档需连续快帧计数,
 * 避免临界机器上满档/降档来回震荡。纯逻辑,无 GL 依赖,可单测。
 */

export type QualityTier = 0 | 1 | 2;

export interface QualityOptions {
  emaAlpha?: number;
  /** EMA 超过该毫秒数并持续 sustain 帧 -> 降一档 */
  downAtMs?: number;
  /** EMA 低于该毫秒数并持续 sustain 帧 -> 升一档 */
  upAtMs?: number;
  sustainFrames?: number;
}

export class QualityGovernor {
  private ema = 16;
  private slowStreak = 0;
  private fastStreak = 0;
  private current: QualityTier = 2;
  private readonly alpha: number;
  private readonly downAtMs: number;
  private readonly upAtMs: number;
  private readonly sustain: number;

  constructor(opts: QualityOptions = {}) {
    this.alpha = opts.emaAlpha ?? 0.1;
    this.downAtMs = opts.downAtMs ?? 32;
    this.upAtMs = opts.upAtMs ?? 12;
    this.sustain = opts.sustainFrames ?? 60;
  }

  get tier(): QualityTier {
    return this.current;
  }

  sample(frameMs: number): QualityTier {
    this.ema = this.ema * (1 - this.alpha) + frameMs * this.alpha;
    if (this.ema > this.downAtMs) {
      this.slowStreak += 1;
      this.fastStreak = 0;
    } else if (this.ema < this.upAtMs) {
      this.fastStreak += 1;
      this.slowStreak = 0;
    } else {
      this.slowStreak = 0;
      this.fastStreak = 0;
    }
    if (this.slowStreak >= this.sustain && this.current > 0) {
      this.current = (this.current - 1) as QualityTier;
      this.slowStreak = 0;
    }
    if (this.fastStreak >= this.sustain * 3 && this.current < 2) {
      this.current = (this.current + 1) as QualityTier;
      this.fastStreak = 0;
    }
    return this.current;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/gl/quality.test.ts`
Expected: PASS 4 tests。

- [ ] **Step 5: 实现 engine.ts（无单测,由 Task 3 demo 路由做浏览器验证）**

```ts
// apps/web/src/features/marketing/components/cinema/gl/engine.ts
/**
 * 手写 WebGL2 迷你引擎:单上下文、全屏三角 pass 链、按需渲染。
 * WHY 按需:滚动静止时不出帧(能耗与温度纪律);进度变化或 pass 声明
 * 自身活跃(模拟中)才排帧。上下文丢失时冻结,恢复后重建全部 pass。
 * 仅供 cinema 使用,不做通用抽象(YAGNI)。
 */

export type QualityTier = 0 | 1 | 2;

export interface PassContext {
  gl: WebGL2RenderingContext;
  timeMs: number;
  progress: ReadonlyMap<string, number>;
  width: number;
  height: number;
  tier: QualityTier;
}

export interface CinemaPass {
  key: string;
  enabled: boolean;
  /** 返回 true 表示模拟仍在演化,需要连续出帧(如流体) */
  isLive?(): boolean;
  init(gl: WebGL2RenderingContext): void;
  render(ctx: PassContext): void;
  dispose(gl: WebGL2RenderingContext): void;
}

/** 全屏大三角:无缓冲区,gl_VertexID 生成,3 顶点覆盖裁剪空间 */
export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function compileProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string
): WebGLProgram {
  const make = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) throw new Error("createShader 失败");
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`着色器编译失败: ${log ?? "无日志"}`);
    }
    return sh;
  };
  const vs = make(gl.VERTEX_SHADER, vsSource);
  const fs = make(gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  if (!prog) throw new Error("createProgram 失败");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`程序链接失败: ${log ?? "无日志"}`);
  }
  return prog;
}

/** 图片 -> 纹理(线性过滤,边缘钳制) */
export function createTexture(
  gl: WebGL2RenderingContext,
  source: TexImageSource
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("createTexture 失败");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  return tex;
}

const MAX_DPR = 1.5;

export class CinemaEngine {
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private passes: CinemaPass[] = [];
  private progressMap = new Map<string, number>();
  private rafId: number | null = null;
  private active = true;
  private contextLost = false;
  private lastFrameAt = 0;
  readonly governor: import("./quality").QualityGovernor;

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    governor: import("./quality").QualityGovernor
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.governor = governor;
    canvas.addEventListener("webglcontextlost", this.onLost, false);
    canvas.addEventListener("webglcontextrestored", this.onRestored, false);
  }

  static create(canvas: HTMLCanvasElement): CinemaEngine | null {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true,
    });
    if (!gl) return null;
    // 构造期动态 import 会引入异步,质量调控器体积极小,直接同步 require 语义:
    // 由调用方注入以保持本模块无循环依赖。
    // 简化:在此内联 new。
    const { QualityGovernor } = requireQuality();
    return new CinemaEngine(canvas, gl, new QualityGovernor());
  }

  addPass(pass: CinemaPass): void {
    pass.init(this.gl);
    this.passes.push(pass);
    this.requestRender();
  }

  setProgress(key: string, v: number): void {
    const prev = this.progressMap.get(key);
    if (prev !== undefined && Math.abs(prev - v) < 1e-5) return;
    this.progressMap.set(key, v);
    this.requestRender();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.requestRender();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.requestRender();
    }
  }

  requestRender(): void {
    if (!this.active || this.contextLost || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    for (const p of this.passes) p.dispose(this.gl);
    this.passes = [];
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
  }

  private frame = (t: number) => {
    this.rafId = null;
    if (this.contextLost || !this.active) return;
    const frameMs = this.lastFrameAt ? t - this.lastFrameAt : 16;
    this.lastFrameAt = t;
    const tier = this.governor.sample(frameMs);
    const { gl } = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ctx: PassContext = {
      gl,
      timeMs: t,
      progress: this.progressMap,
      width: this.canvas.width,
      height: this.canvas.height,
      tier,
    };
    let live = false;
    for (const p of this.passes) {
      if (!p.enabled) continue;
      p.render(ctx);
      if (p.isLive?.()) live = true;
    }
    // 模拟活跃(流体演化中)则持续出帧,否则等待下一次进度变化
    if (live) this.requestRender();
  };

  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };

  private onRestored = () => {
    const gl = this.canvas.getContext("webgl2");
    if (!gl) return;
    this.gl = gl;
    this.contextLost = false;
    for (const p of this.passes) p.init(gl);
    this.requestRender();
  };
}

// WHY 独立函数:engine 与 quality 同目录,静态 import 即可;
// 包一层便于将来替换注入。保持简单。
import { QualityGovernor as QG } from "./quality";
function requireQuality(): { QualityGovernor: typeof QG } {
  return { QualityGovernor: QG };
}
```

- [ ] **Step 6: typecheck + lint**

Run: `pnpm --filter @repo/web exec tsc --noEmit && cd apps/web && pnpm exec biome lint src/features/marketing/components/cinema/ && cd ../..`
Expected: 0 error。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/gl/
git commit -m "feat(web): cinema WebGL2 迷你引擎与质量调控器" -m "单上下文按需渲染+上下文丢失恢复;EMA 滞回分档防临界震荡,纯逻辑单测覆盖。零新依赖。"
```

---

### Task 3: dom-sync + 胶片后处理 pass + CinemaGL 挂载 + demo 路由

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/dom-sync.ts`
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/post.ts`
- Create: `apps/web/src/features/marketing/components/cinema/cinema-gl.tsx`
- Create: `apps/web/src/app/[locale]/(marketing)/demo/cinema/page.tsx`
- Test: `apps/web/src/features/marketing/components/cinema/gl/dom-sync.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `CinemaEngine`、`CinemaPass`、`compileProgram`、`FULLSCREEN_VS`。
- Produces:
  - `interface ViewportRect { x: number; y: number; w: number; h: number }`（视口宽高分数，y 自顶向下）
  - `rectToViewportFractions(rect, vw, vh): ViewportRect`
  - `trackElement(el: HTMLElement, cb: (r: ViewportRect) => void): () => void`（scroll/resize 合并到 rAF，返回解除函数）
  - `createPostPass(): CinemaPass`（读 progress 键 `postGrain`/`postVignette`，默认 0.05/0.35）
  - `<CinemaGLProvider>` + `useCinema(): { status: GLStatus; engine: CinemaEngine | null; setTakeover(on: boolean): void }`；`type GLStatus = "full" | "lite" | "static"`
  - 探测阶梯：`prefers-reduced-motion` 或视口 < 768px 为 `static`；`CinemaEngine.create` 返回 null 为 `lite`；运行中 governor tier 降至 0 时引擎销毁并降 `lite`。

- [ ] **Step 1: 写 dom-sync 纯函数失败测试**

```ts
// apps/web/src/features/marketing/components/cinema/gl/dom-sync.test.ts
// rect 到视口分数换算:GL 定位画布矩形的唯一坐标事实。
import { describe, expect, it } from "vitest";
import { rectToViewportFractions } from "./dom-sync";

describe("rectToViewportFractions", () => {
  it("满屏元素为 (0,0,1,1)", () => {
    const r = rectToViewportFractions(
      { left: 0, top: 0, width: 1000, height: 800 },
      1000,
      800
    );
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("居中半宽半高元素", () => {
    const r = rectToViewportFractions(
      { left: 250, top: 200, width: 500, height: 400 },
      1000,
      800
    );
    expect(r.x).toBeCloseTo(0.25, 10);
    expect(r.y).toBeCloseTo(0.25, 10);
    expect(r.w).toBeCloseTo(0.5, 10);
    expect(r.h).toBeCloseTo(0.5, 10);
  });

  it("零视口尺寸不产生 NaN", () => {
    const r = rectToViewportFractions(
      { left: 10, top: 10, width: 100, height: 100 },
      0,
      0
    );
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.w)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/gl/dom-sync.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 dom-sync.ts**

```ts
// apps/web/src/features/marketing/components/cinema/gl/dom-sync.ts
/**
 * DOM 元素矩形到视口分数换算,供 GL 在 DOM 元素原位绘制(scrollrig 手法)。
 * 追踪器把 scroll/resize 合并到 rAF,避免高频布局读写抖动。
 */

export interface ViewportRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectToViewportFractions(
  rect: { left: number; top: number; width: number; height: number },
  vw: number,
  vh: number
): ViewportRect {
  const sw = vw > 0 ? vw : 1;
  const sh = vh > 0 ? vh : 1;
  return {
    x: rect.left / sw,
    y: rect.top / sh,
    w: rect.width / sw,
    h: rect.height / sh,
  };
}

export function trackElement(
  el: HTMLElement,
  cb: (r: ViewportRect) => void
): () => void {
  let raf: number | null = null;
  const measure = () => {
    raf = null;
    const rect = el.getBoundingClientRect();
    cb(rectToViewportFractions(rect, window.innerWidth, window.innerHeight));
  };
  const schedule = () => {
    if (raf === null) raf = requestAnimationFrame(measure);
  };
  schedule();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  return () => {
    if (raf !== null) cancelAnimationFrame(raf);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @repo/web exec vitest run src/features/marketing/components/cinema/gl/dom-sync.test.ts`
Expected: PASS 3 tests。

- [ ] **Step 5: 实现 post pass（IGN 颗粒 + 晕影；halation 并入 denoise/manifesto 的辉光 uniform，不在 post 重复）**

```ts
// apps/web/src/features/marketing/components/cinema/gl/passes/post.ts
/**
 * 胶片后处理:IGN 颗粒 + 边缘晕影,半透明黑罩合成于整页之上。
 * WHY IGN:interleaved gradient noise 免纹理资产,视觉近蓝噪声,
 * 逐帧偏移防静态纹样。强度极低(默认颗粒 0.05)保持编辑部克制。
 */
import {
  type CinemaPass,
  compileProgram,
  FULLSCREEN_VS,
  type PassContext,
} from "../engine";

const FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
out vec4 outColor;
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float g = ign(gl_FragCoord.xy + vec2(mod(uTime * 0.06, 64.0)));
  float v = smoothstep(0.55, 1.05, distance(uv, vec2(0.5)) * 1.2);
  float a = clamp(v * uVignette + (g - 0.5) * uGrain, 0.0, 1.0);
  outColor = vec4(0.0, 0.0, 0.0, a);
}`;

export function createPostPass(): CinemaPass {
  let prog: WebGLProgram | null = null;
  let uSize: WebGLUniformLocation | null = null;
  let uTime: WebGLUniformLocation | null = null;
  let uGrain: WebGLUniformLocation | null = null;
  let uVignette: WebGLUniformLocation | null = null;
  return {
    key: "post",
    enabled: true,
    init(gl) {
      prog = compileProgram(gl, FULLSCREEN_VS, FS);
      uSize = gl.getUniformLocation(prog, "uSize");
      uTime = gl.getUniformLocation(prog, "uTime");
      uGrain = gl.getUniformLocation(prog, "uGrain");
      uVignette = gl.getUniformLocation(prog, "uVignette");
    },
    render(ctx: PassContext) {
      const { gl } = ctx;
      if (!prog) return;
      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(uSize, ctx.width, ctx.height);
      gl.uniform1f(uTime, ctx.timeMs);
      gl.uniform1f(uGrain, ctx.progress.get("postGrain") ?? 0.05);
      gl.uniform1f(uVignette, ctx.progress.get("postVignette") ?? 0.35);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      prog = null;
    },
  };
}
```

- [ ] **Step 6: 实现 cinema-gl.tsx（探测阶梯 + 固定画布 + context）**

```tsx
// apps/web/src/features/marketing/components/cinema/cinema-gl.tsx
"use client";

/**
 * GL 摄影棚挂载层:固定全屏画布 + 引擎生命周期 + 状态探测阶梯。
 * full 为 WebGL2 全效;lite 为 GL 不可用或降档后的 DOM 管线;
 * static 为减动效或窄屏。画布 pointer-events-none;takeover 时
 * 提升 z 盖过正文(仅钉住转场窗口内,窗口中无可交互内容)。
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CinemaEngine } from "./gl/engine";
import { createPostPass } from "./gl/passes/post";

export type GLStatus = "full" | "lite" | "static";

interface CinemaContextValue {
  status: GLStatus;
  engine: CinemaEngine | null;
  setTakeover: (on: boolean) => void;
}

const CinemaContext = createContext<CinemaContextValue>({
  status: "static",
  engine: null,
  setTakeover: () => {},
});

export function useCinema(): CinemaContextValue {
  return useContext(CinemaContext);
}

/** 初始探测:减动效/窄屏直接 static,不建上下文 */
function probeInitialStatus(): GLStatus {
  if (typeof window === "undefined") return "static";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "static";
  }
  if (window.innerWidth < 768) return "static";
  return "full";
}

export function CinemaGLProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [engine, setEngine] = useState<CinemaEngine | null>(null);
  const [status, setStatus] = useState<GLStatus>("static");
  const [probed, setProbed] = useState(false);
  const [takeover, setTakeover] = useState(false);

  // 先探测决定是否渲染 canvas,再在 canvas 就绪后建引擎(两段 effect)
  useEffect(() => {
    setStatus(probeInitialStatus());
    setProbed(true);
  }, []);

  useEffect(() => {
    if (!probed || status !== "full" || !canvasRef.current) return;
    const created = CinemaEngine.create(canvasRef.current);
    if (!created) {
      setStatus("lite");
      return;
    }
    created.addPass(createPostPass());
    created.resize();
    const onResize = () => created.resize();
    window.addEventListener("resize", onResize);
    setEngine(created);
    // 运行中降档:governor 到 0 则退出 GL 走 lite
    const watchdog = window.setInterval(() => {
      if (created.governor.tier === 0) {
        window.clearInterval(watchdog);
        window.removeEventListener("resize", onResize);
        created.dispose();
        setEngine(null);
        setStatus("lite");
      }
    }, 2000);
    return () => {
      window.clearInterval(watchdog);
      window.removeEventListener("resize", onResize);
      created.dispose();
      setEngine(null);
    };
  }, [probed, status]);

  return (
    <CinemaContext.Provider value={{ status, engine, setTakeover }}>
      {status === "full" ? (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          data-takeover={takeover ? "true" : "false"}
          className="pointer-events-none fixed inset-0 h-full w-full data-[takeover=false]:z-[1] data-[takeover=true]:z-40"
        />
      ) : null}
      {children}
    </CinemaContext.Provider>
  );
}
```

- [ ] **Step 7: demo 路由（联调载体，Task 14 删除）**

```tsx
// apps/web/src/app/[locale]/(marketing)/demo/cinema/page.tsx
/**
 * cinema 联调预览页:滚动区 + GL 摄影棚。
 * 仅开发联调用,首页集成完成后随 Task 14 删除。
 */
import { CinemaGLProvider } from "@/features/marketing/components/cinema/cinema-gl";

export default function CinemaDemoPage() {
  return (
    <CinemaGLProvider>
      <main className="min-h-[400vh] bg-background">
        <div className="sticky top-0 flex h-screen items-center justify-center">
          <p className="font-serif text-2xl">cinema GL demo</p>
        </div>
      </main>
    </CinemaGLProvider>
  );
}
```

- [ ] **Step 8: 浏览器验证（dev server 运行于 3000）**

Playwright 打开 `http://localhost:3000/zh/demo/cinema`：
- `browser_evaluate`: 检查 `document.querySelector("canvas[data-takeover]")` 非空；
- `browser_console_messages(level:"error")` 无 GL 相关错误；
- 截图确认页面有轻微颗粒与边缘晕影。

- [ ] **Step 9: typecheck + lint + Commit**

Run: `pnpm --filter @repo/web exec tsc --noEmit && cd apps/web && pnpm exec biome lint src/features/marketing/components/cinema/ && cd ../..`

```bash
git add apps/web/src/features/marketing/components/cinema/ "apps/web/src/app/[locale]/(marketing)/demo/cinema/"
git commit -m "feat(web): cinema GL 挂载层与胶片后处理" -m "固定画布+探测阶梯(full/lite/static)+运行中降档退出;IGN 颗粒免纹理资产。demo 路由为逐幕联调载体。"
```

---

### Task 4: CinemaStage 主舞台与 SceneLayer 原语

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/cinema-stage.tsx`
- Modify: `apps/web/src/app/[locale]/(marketing)/demo/cinema/page.tsx`（换用 CinemaStage）

**Interfaces:**
- Consumes: Task 1 `filmTotalVh`/`sceneProgress`；Task 3 `useCinema`。
- Produces:
  - `<CinemaStage>{children}</CinemaStage>`：`filmTotalVh()` vh 行程容器 + sticky 视口；master 进度喂 `engine.setProgress("master", v)`。
  - `useMaster(): MotionValue<number>`
  - `<SceneLayer scene key className>`：absolute 全幅层，窗口外透明且 pointer-events 关闭；把幕内进度喂 `engine.setProgress(scene, p)`。
  - `useSceneProgress(scene: SceneKey): MotionValue<number>`

- [ ] **Step 1: 实现 cinema-stage.tsx**

```tsx
// apps/web/src/features/marketing/components/cinema/cinema-stage.tsx
"use client";

/**
 * 影片主舞台:filmTotalVh 高的行程容器 + sticky 视口。
 * WHY 单时间轴:各幕若各自 useScroll,交界处进度对不齐,转场会跳变;
 * 单 master + 纯函数窗口切分保证任意滚动位置全片状态可复现(倒放成立)。
 */
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import { createContext, type ReactNode, useContext, useRef } from "react";
import { filmTotalVh, type SceneKey, sceneProgress } from "./cinema-config";
import { useCinema } from "./cinema-gl";

const MasterContext = createContext<MotionValue<number> | null>(null);

export function useMaster(): MotionValue<number> {
  const mv = useContext(MasterContext);
  if (!mv) throw new Error("useMaster 必须在 CinemaStage 内使用");
  return mv;
}

export function useSceneProgress(scene: SceneKey): MotionValue<number> {
  const master = useMaster();
  // 函数式回调(铁律):不用 range-array 版本
  return useTransform(master, (m) => sceneProgress(m, scene));
}

export function CinemaStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { engine } = useCinema();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    engine?.setProgress("master", v);
  });

  return (
    <div ref={ref} style={{ height: `${filmTotalVh()}vh` }}>
      <div className="sticky top-0 h-screen overflow-hidden">
        <MasterContext.Provider value={scrollYProgress}>
          {children}
        </MasterContext.Provider>
      </div>
    </div>
  );
}

/** 单幕层:窗口外透明且不可交互;transform 由各幕内层自管,本层只管透明度 */
export function SceneLayer({
  scene,
  children,
  className,
}: {
  scene: SceneKey;
  children: ReactNode;
  className?: string;
}) {
  const master = useMaster();
  const { engine } = useCinema();
  useMotionValueEvent(master, "change", (m) => {
    engine?.setProgress(scene, sceneProgress(m, scene));
  });
  // 幕内可见:窗口边缘 2% 淡入淡出,避免交界闪切
  const opacity = useTransform(master, (m) => {
    const p = sceneProgress(m, scene);
    if (p <= 0 || p >= 1) return 0;
    const edge = 0.02;
    return Math.min(1, Math.min(p, 1 - p) / edge);
  });
  const pointerEvents = useTransform(master, (m) => {
    const p = sceneProgress(m, scene);
    return p > 0 && p < 1 ? "auto" : "none";
  });
  return (
    <motion.div
      style={{ opacity, pointerEvents }}
      className={`absolute inset-0 ${className ?? ""}`}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: demo 路由改为 CinemaStage + 两个占位幕**

```tsx
// apps/web/src/app/[locale]/(marketing)/demo/cinema/page.tsx 全量替换
import { CinemaGLProvider } from "@/features/marketing/components/cinema/cinema-gl";
import {
  CinemaStage,
  SceneLayer,
} from "@/features/marketing/components/cinema/cinema-stage";

export default function CinemaDemoPage() {
  return (
    <CinemaGLProvider>
      <main className="bg-background">
        <CinemaStage>
          <SceneLayer scene="opening">
            <div className="flex h-full items-center justify-center">
              <p className="font-serif text-4xl">opening</p>
            </div>
          </SceneLayer>
          <SceneLayer scene="generate">
            <div className="flex h-full items-center justify-center">
              <p className="font-serif text-4xl">generate</p>
            </div>
          </SceneLayer>
        </CinemaStage>
      </main>
    </CinemaGLProvider>
  );
}
```

- [ ] **Step 3: 浏览器验证**

Playwright 打开 demo 页，`browser_evaluate` 以
`document.scrollingElement.scrollTo(0, document.body.scrollHeight * f)` 精确落点后读
`getComputedStyle`：
- f=0.06（opening 腹地）：文本 "opening" opacity 为 1，"generate" 为 0；
- f=0.20（generate 腹地）：反转；
- 滚回 f=0.06 再验 opening 为 1（倒放成立）。

- [ ] **Step 4: typecheck + lint + Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/cinema-stage.tsx "apps/web/src/app/[locale]/(marketing)/demo/cinema/page.tsx"
git commit -m "feat(web): cinema 主舞台单时间轴与 SceneLayer 原语" -m "全片单 master 进度+纯函数窗口切分,任意滚动位置可复现与倒放;窗口边缘 2% 淡化防交界闪切。"
```

---

### Task 5: 去噪显影 pass + 第二幕 scene-generate

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/denoise.ts`
- Create: `apps/web/src/features/marketing/components/cinema/scene-generate.tsx`
- Create: `apps/web/public/cinema/artwork-hero.webp`（资产准备见 Step 2）
- Modify: `apps/web/src/app/[locale]/(marketing)/demo/cinema/page.tsx`（挂 GenerateScene 与 denoise pass）

**Interfaces:**
- Consumes: Task 2 `compileProgram`/`createTexture`；Task 3 `trackElement`/`useCinema`；Task 4 `SceneLayer`/`useSceneProgress`。
- Produces:
  - `createDenoisePass(image: TexImageSource): CinemaPass`——读 progress 键：`denoiseP`（显影进度）、`canvasRect.x/y/w/h`（画布矩形视口分数）、`denoiseGlow`（白部辉光）。`canvasRect.w <= 0` 时不绘制（画布不在场）。
  - `<GenerateScene />`；画布占位 figure 的 rect 经 trackElement 喂 GL。

- [ ] **Step 1: 实现 denoise.ts（完整着色器）**

```ts
// apps/web/src/features/marketing/components/cinema/gl/passes/denoise.ts
/**
 * 扩散显影 pass:IGN 阈值 + 低频噪场偏置的逐像素显影。
 * 每个像素有自己的显影时刻——"真实的去噪过程视觉",
 * 区别于整图交叉淡化。画布矩形由 dom-sync 喂入,GL 在 DOM 原位绘制。
 */
import {
  type CinemaPass,
  compileProgram,
  createTexture,
  FULLSCREEN_VS,
  type PassContext,
} from "../engine";

const FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform sampler2D uImage;
uniform vec4 uRect;
uniform float uP;
uniform float uGlow;
uniform float uTime;
out vec4 outColor;
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
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
void main() {
  vec2 frag = gl_FragCoord.xy / uSize;
  vec2 uv = vec2(frag.x, 1.0 - frag.y);
  vec2 local = (uv - uRect.xy) / uRect.zw;
  if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  float threshold = ign(gl_FragCoord.xy) * 0.6 + fbm(local * 6.0) * 0.4;
  float reveal = smoothstep(
    threshold - 0.08,
    threshold + 0.08,
    uP * 1.16 - 0.08
  );
  vec3 img = texture(uImage, local).rgb;
  float n = fbm(local * 9.0 + vec2(uTime * 0.00012, uTime * 0.00007));
  vec3 noiseCol = vec3(0.72 + n * 0.2);
  vec3 col = mix(noiseCol, img, reveal);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += uGlow * smoothstep(0.75, 1.0, lum) * 0.25;
  outColor = vec4(col, 1.0);
}`;

export function createDenoisePass(image: TexImageSource): CinemaPass {
  let prog: WebGLProgram | null = null;
  let tex: WebGLTexture | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const names = ["uSize", "uImage", "uRect", "uP", "uGlow", "uTime"] as const;
  return {
    key: "denoise",
    enabled: true,
    init(gl) {
      prog = compileProgram(gl, FULLSCREEN_VS, FS);
      tex = createTexture(gl, image);
      for (const name of names) {
        loc[name] = gl.getUniformLocation(prog, name);
      }
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!prog || !tex) return;
      const w = progress.get("canvasRect.w") ?? 0;
      if (w <= 0) return;
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc.uImage ?? null, 0);
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform4f(
        loc.uRect ?? null,
        progress.get("canvasRect.x") ?? 0,
        progress.get("canvasRect.y") ?? 0,
        w,
        progress.get("canvasRect.h") ?? 0
      );
      gl.uniform1f(loc.uP ?? null, progress.get("denoiseP") ?? 0);
      gl.uniform1f(loc.uGlow ?? null, progress.get("denoiseGlow") ?? 0);
      gl.uniform1f(loc.uTime ?? null, ctx.timeMs);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      if (tex) gl.deleteTexture(tex);
      prog = null;
      tex = null;
    },
  };
}
```

- [ ] **Step 2: 资产准备**

从 `apps/web/public/` 现有营销样张中选一张构图居中、黑白对比强的图复制为
`apps/web/public/cinema/artwork-hero.webp`（如源为 png 则保留 png 扩展名并同步
代码中的路径）。若 public 下无可用样张，用浏览器 canvas 生成 1024x1024
排版占位图（深灰底白衬线字 GPT2IMAGE）导出——不从外部下载资产。

- [ ] **Step 3: 实现 scene-generate.tsx**

```tsx
// apps/web/src/features/marketing/components/cinema/scene-generate.tsx
"use client";

/**
 * 第二幕:去噪奇观。画布占位 figure 经 dom-sync 喂 GL 原位绘制;
 * 幕内进度驱动 denoiseP;页边 EXIF 式采样 HUD;FeatureGrid 卖点
 * 化作画布两侧解说词,各占等分窗口交替浮现。
 * lite 态由 CSS 噪点罩+模糊衰减兜底(v1 中端管线)。
 */
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useTransform,
} from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { bell } from "./cinema-config";
import { useCinema } from "./cinema-gl";
import { useSceneProgress } from "./cinema-stage";
import { trackElement } from "./gl/dom-sync";

// 实现前先与 feature-grid.tsx 及 messages/en.json 核对真实 key 列表,
// 以下键名为示意,须替换为 FeatureGrid 实际使用的 key(数量 3-6 均可)。
const FEATURE_KEYS = ["quality", "speed", "control"] as const;

export function GenerateScene() {
  const t = useTranslations("Features");
  const p = useSceneProgress("generate");
  const { engine, status } = useCinema();
  const figureRef = useRef<HTMLDivElement | null>(null);
  const [hudStep, setHudStep] = useState(1);

  useEffect(() => {
    if (status !== "full" || !figureRef.current || !engine) return;
    return trackElement(figureRef.current, (r) => {
      engine.setProgress("canvasRect.x", r.x);
      engine.setProgress("canvasRect.y", r.y);
      engine.setProgress("canvasRect.w", r.w);
      engine.setProgress("canvasRect.h", r.h);
    });
  }, [engine, status]);

  useMotionValueEvent(p, "change", (v) => {
    engine?.setProgress("denoiseP", v);
    engine?.setProgress("denoiseGlow", bell(v) * 0.6);
    setHudStep(Math.max(1, Math.min(28, Math.floor(1 + v * 27))));
  });

  return (
    <div className="container flex h-full items-center justify-center gap-12">
      <div
        ref={figureRef}
        className="relative aspect-square w-[min(52vh,480px)] shrink-0 border border-border bg-background"
      >
        {status !== "full" ? <LiteCanvasFill progress={p} /> : null}
        <div className="absolute -bottom-8 left-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          step {String(hudStep).padStart(2, "0")} / 28 · denoising
        </div>
      </div>
      <div className="relative h-[420px] max-w-md flex-1">
        {FEATURE_KEYS.map((key, i) => (
          <Caption
            key={key}
            index={i}
            total={FEATURE_KEYS.length}
            progress={p}
            title={t(`${key}.title`)}
            desc={t(`${key}.description`)}
          />
        ))}
      </div>
    </div>
  );
}

function Caption({
  index,
  total,
  progress,
  title,
  desc,
}: {
  index: number;
  total: number;
  progress: MotionValue<number>;
  title: string;
  desc: string;
}) {
  // 各解说词占等分窗口,中心全亮边缘淡出;位移与透明度分层绑定(铁律)
  const local = useTransform(progress, (v) => {
    const p = (v - index / total) * total;
    return Math.max(0, Math.min(1, p));
  });
  const y = useTransform(local, (v) => (1 - bell(v)) * 32 * (v < 0.5 ? 1 : -1));
  const opacity = useTransform(local, (v) => bell(v));
  return (
    <motion.div style={{ y }} className="absolute inset-x-0 top-1/2">
      <motion.div style={{ opacity }} className="-translate-y-1/2">
        <h3 className="mb-3 font-serif text-3xl font-medium tracking-tight">
          {title}
        </h3>
        <p className="leading-relaxed text-muted-foreground">{desc}</p>
      </motion.div>
    </motion.div>
  );
}

/** lite 态画布填充:静态样张 + CSS 噪点罩随进度衰减 */
function LiteCanvasFill({ progress }: { progress: MotionValue<number> }) {
  const noiseOpacity = useTransform(progress, (v) => 1 - v);
  const blur = useTransform(progress, (v) => `blur(${(1 - v) * 14}px)`);
  return (
    <>
      <motion.img
        src="/cinema/artwork-hero.webp"
        alt=""
        aria-hidden="true"
        style={{ filter: blur }}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <motion.div
        style={{ opacity: noiseOpacity }}
        className="absolute inset-0 bg-[repeating-conic-gradient(from_0deg,transparent_0deg,rgba(127,127,127,0.5)_1deg,transparent_2deg)]"
      />
    </>
  );
}
```

denoise pass 的挂载（demo 页与后续首页相同写法）：

```tsx
// 挂载处(client effect):样张解码完成后注册 pass
useEffect(() => {
  if (!engine) return;
  const img = new Image();
  img.src = "/cinema/artwork-hero.webp";
  let disposed = false;
  img.decode().then(() => {
    if (!disposed) engine.addPass(createDenoisePass(img));
  });
  return () => {
    disposed = true;
  };
}, [engine]);
```

- [ ] **Step 4: demo 路由挂 GenerateScene 与 denoise pass，浏览器逐幕验收**

Playwright 精确落点验收：
- generate 窗口 30%：画布区域为游走噪场，HUD 约 step 09；
- 窗口 95%：样张几乎全显影，HUD step 27-28；
- 滚回 30%：显影退回（倒放成立）；
- 三条解说词各在自己窗口内 opacity 峰值，窗口外为 0。

- [ ] **Step 5: typecheck + lint + Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/ apps/web/public/cinema/ "apps/web/src/app/[locale]/(marketing)/demo/cinema/page.tsx"
git commit -m "feat(web): cinema 去噪显影奇观与第二幕" -m "IGN 阈值+噪场偏置逐像素显影(非整图淡化);画布 dom-sync 原位绘制;FeatureGrid 卖点转解说词;lite 态 CSS 噪点+模糊衰减兜底。"
```

---

### Task 6: 粒子 pass + 文本纹理 + 序幕 scene-opening

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/particles.ts`
- Create: `apps/web/src/features/marketing/components/cinema/gl/text-texture.ts`
- Modify: `apps/web/src/features/marketing/components/cinema/gl/passes/denoise.ts`（签名扩展，见 Step 1）
- Create: `apps/web/src/features/marketing/components/cinema/scene-opening.tsx`
- Modify: demo 路由（挂 OpeningScene）

**Interfaces:**
- Consumes: Task 2/3/4/5 全部原语。
- Produces:
  - `createDenoisePass(image: TexImageSource, keys?: { rect: string; p: string; glow: string; visible: string })`——默认 `{ rect: "canvasRect", p: "denoiseP", glow: "denoiseGlow", visible: "denoiseVisible" }`，读 `${keys.rect}.x/y/w/h`；`visible < 0.5` 时跳绘。标题显影复用该 pass：`createDenoisePass(titleCanvas, { rect: "titleRect", p: "titleP", glow: "titleGlow", visible: "titleVisible" })`。
  - `createParticlesPass(image: TexImageSource | null): CinemaPass`——读键：`splashP`（0-1 演出进度）、`splashOx/splashOy`（原点视口分数）、`splashMode`（0 墨溅 / 1 布局 morph，morph 另读 `morphRectA.x/y/w/h` 与 `morphP`）。粒子数按 tier：2 档 24000 / 1 档 6000。
  - `renderTextTexture(text: string, opts: { fontPx: number; width: number; height: number; color: string }): Promise<HTMLCanvasElement>`（等待 `document.fonts` 就绪后绘制，衬线栈与站点一致）。
  - `<OpeningScene />`：Hero 标题/副行/CTA（沿用 Hero i18n key）+ 墨滴 + 标题显影 + 画布登场 + prompt 打字。

- [ ] **Step 1: denoise.ts 签名扩展（keys 参数 + visible 门）**

```ts
// denoise.ts 修改点:工厂签名与 render 读键
export interface DenoiseKeys {
  rect: string;
  p: string;
  glow: string;
  visible: string;
}

const DEFAULT_KEYS: DenoiseKeys = {
  rect: "canvasRect",
  p: "denoiseP",
  glow: "denoiseGlow",
  visible: "denoiseVisible",
};

export function createDenoisePass(
  image: TexImageSource,
  keys: DenoiseKeys = DEFAULT_KEYS
): CinemaPass {
  // render 内:
  //   if ((progress.get(keys.visible) ?? 1) < 0.5) return;
  //   const w = progress.get(`${keys.rect}.w`) ?? 0; ...
  //   gl.uniform1f(loc.uP ?? null, progress.get(keys.p) ?? 0);
  //   gl.uniform1f(loc.uGlow ?? null, progress.get(keys.glow) ?? 0);
  // 其余不变。pass key 取 `denoise:${keys.rect}` 以便多实例共存。
}
```

同步修改 scene-generate.tsx：`useMotionValueEvent(p, "change", ...)` 中追加
`engine?.setProgress("denoiseVisible", v > 0 && v < 1 ? 1 : 0)`。
跑 Task 5 的 demo 验收确认行为不回归。

- [ ] **Step 2: 实现 particles.ts（完整着色器）**

```ts
// apps/web/src/features/marketing/components/cinema/gl/passes/particles.ts
/**
 * 实例化粒子 pass:gl.POINTS + gl_VertexID 派生一切,零缓冲区。
 * 模式 0 墨溅:原点迸溅+伪重力,位置是进度的纯函数(倒放成立);
 * 模式 1 布局 morph:画布矩形内均匀采样 -> 4x4 网格重排,途中曲线扰动,
 * 颜色在顶点阶段采样图像纹理(WebGL2 VS 纹理拾取)。
 */
import {
  type CinemaPass,
  compileProgram,
  createTexture,
  type PassContext,
} from "../engine";

const VS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uCount;
uniform float uMode;
uniform float uP;
uniform vec2 uOrigin;
uniform vec4 uRectA;
uniform sampler2D uImage;
out vec3 vColor;
out float vAlpha;

float hash1(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

// 视口分数 -> 裁剪空间(y 翻转:分数系自顶向下)
vec2 toClip(vec2 f) {
  return vec2(f.x * 2.0 - 1.0, (1.0 - f.y) * 2.0 - 1.0);
}

void main() {
  float i = float(gl_VertexID);
  float r1 = hash1(i);
  float r2 = hash1(i + 0.618);
  float r3 = hash1(i + 1.618);
  vec2 pos;
  float alpha;
  float size;
  vColor = vec3(0.06);
  if (uMode < 0.5) {
    // 墨溅:极角+速度散布,伪重力下坠,进度即时间
    float ang = r1 * 6.28318;
    float spd = 0.05 + r2 * 0.22;
    float t = uP;
    vec2 vel = vec2(cos(ang), sin(ang) * 0.6 - 0.4) * spd;
    pos = uOrigin + vel * t + vec2(0.0, 0.55) * t * t;
    alpha = (1.0 - t) * (0.35 + r3 * 0.5);
    size = (1.0 + r3 * 2.0) * (1.0 - t * 0.6);
  } else {
    // 布局 morph:源=uRectA 内 sqrt(uCount) 方阵采样;目标=全视口 4x4 格中心
    float side = floor(sqrt(uCount));
    float col = mod(i, side);
    float row = floor(i / side);
    vec2 srcLocal = vec2((col + 0.5) / side, (row + 0.5) / side);
    vec2 src = uRectA.xy + srcLocal * uRectA.zw;
    float tile = floor(mod(i, 16.0));
    vec2 tileCenter = vec2(
      (mod(tile, 4.0) + 0.5) / 4.0,
      (floor(tile / 4.0) + 0.5) / 4.0
    );
    // 目标点带瓦片内散布,重凝时收紧
    vec2 spread = (vec2(r2, r3) - 0.5) * 0.16 * (1.0 - uP);
    vec2 dst = tileCenter + spread;
    float bellP = 1.0 - abs(uP * 2.0 - 1.0);
    vec2 wander = vec2(
      sin(i * 0.37 + uP * 9.0),
      cos(i * 0.29 + uP * 7.0)
    ) * 0.04 * bellP;
    pos = mix(src, dst, smoothstep(0.0, 1.0, uP)) + wander;
    vColor = texture(uImage, srcLocal).rgb;
    alpha = 0.9;
    size = 2.0 + bellP * 2.0;
  }
  vAlpha = alpha;
  gl_Position = vec4(toClip(pos), 0.0, 1.0);
  gl_PointSize = size * (uSize.y / 900.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float m = smoothstep(0.5, 0.2, length(d));
  outColor = vec4(vColor, vAlpha * m);
}`;

export function createParticlesPass(
  image: TexImageSource | null
): CinemaPass {
  let prog: WebGLProgram | null = null;
  let tex: WebGLTexture | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const names = [
    "uSize",
    "uCount",
    "uMode",
    "uP",
    "uOrigin",
    "uRectA",
    "uImage",
  ] as const;
  return {
    key: "particles",
    enabled: true,
    init(gl) {
      prog = compileProgram(gl, VS, FS);
      if (image) tex = createTexture(gl, image);
      for (const name of names) {
        loc[name] = gl.getUniformLocation(prog, name);
      }
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!prog) return;
      const mode = progress.get("splashMode") ?? 0;
      const p =
        mode < 0.5
          ? (progress.get("splashP") ?? 0)
          : (progress.get("morphP") ?? 0);
      if (p <= 0 || p >= 1) return;
      const count = ctx.tier >= 2 ? 24000 : 6000;
      gl.useProgram(prog);
      if (tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc.uImage ?? null, 0);
      }
      gl.enable(gl.BLEND);
      // 透明预乘画布:alpha 通道必须直通(见文首勘误一)
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(loc.uCount ?? null, count);
      gl.uniform1f(loc.uMode ?? null, mode);
      gl.uniform1f(loc.uP ?? null, p);
      gl.uniform2f(
        loc.uOrigin ?? null,
        progress.get("splashOx") ?? 0.5,
        progress.get("splashOy") ?? 0.3
      );
      gl.uniform4f(
        loc.uRectA ?? null,
        progress.get("morphRectA.x") ?? 0.3,
        progress.get("morphRectA.y") ?? 0.25,
        progress.get("morphRectA.w") ?? 0.4,
        progress.get("morphRectA.h") ?? 0.5
      );
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      if (tex) gl.deleteTexture(tex);
      prog = null;
      tex = null;
    },
  };
}
```

- [ ] **Step 3: 实现 text-texture.ts**

```ts
// apps/web/src/features/marketing/components/cinema/gl/text-texture.ts
/**
 * 把衬线标题渲到离屏 canvas 作 GL 纹理,供"墨渗入纸"式显影。
 * WHY 等字体:document.fonts.ready 前绘制会落到回退字体,
 * 显影出来的字形与 DOM 不一致,穿帮。
 */
export async function renderTextTexture(
  text: string,
  opts: { fontPx: number; width: number; height: number; color: string }
): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d 上下文不可用");
  ctx.clearRect(0, 0, opts.width, opts.height);
  ctx.fillStyle = opts.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 ${opts.fontPx}px "Noto Serif Variable", "Noto Serif SC Variable", serif`;
  // 简单折行:按空格与 CJK 字符断行,行高 1.15
  const lines = wrapText(ctx, text, opts.width * 0.9);
  const lineH = opts.fontPx * 1.15;
  const startY = opts.height / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, opts.width / 2, startY + i * lineH);
  });
  return canvas;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const units = text.match(/[一-鿿]|\S+|\s/g) ?? [text];
  const lines: string[] = [];
  let cur = "";
  for (const u of units) {
    const probe = cur + u;
    if (ctx.measureText(probe).width > maxWidth && cur.trim() !== "") {
      lines.push(cur.trim());
      cur = u;
    } else {
      cur = probe;
    }
  }
  if (cur.trim() !== "") lines.push(cur.trim());
  return lines;
}
```

- [ ] **Step 4: 实现 scene-opening.tsx**

```tsx
// apps/web/src/features/marketing/components/cinema/scene-opening.tsx
"use client";

/**
 * 序幕+第一幕:墨滴坠落迸溅 -> 标题墨渗显影 -> Hero 内容退场 ->
 * 画布四边发丝线合拢登场 -> prompt 逐字打出+画布内噪点呼吸。
 * 标题真实 DOM 常驻(SEO);full 态下 DOM 字透明,GL 在原位显影。
 * i18n 沿用 Hero 命名空间(实现前 grep hero-section.tsx 核对 key)。
 */
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useTransform,
} from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useCinema } from "./cinema-gl";
import { useSceneProgress } from "./cinema-stage";
import { trackElement } from "./gl/dom-sync";

// 幕内窗口(序幕总 200vh):
// 墨滴 [0,0.10] 标题显影 [0.06,0.30] Hero 退场 [0.30,0.45]
// 画布登场 [0.42,0.58] prompt 打字 [0.58,0.95]
const seg = (p: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (p - a) / (b - a)));

export function OpeningScene() {
  const t = useTranslations("Hero");
  const locale = useLocale();
  const p = useSceneProgress("opening");
  const { engine, status } = useCinema();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // 墨滴与标题显影 -> GL
  useMotionValueEvent(p, "change", (v) => {
    engine?.setProgress("splashMode", 0);
    engine?.setProgress("splashP", seg(v, 0, 0.1));
    engine?.setProgress("splashOx", 0.5);
    engine?.setProgress("splashOy", 0.24);
    engine?.setProgress("titleP", seg(v, 0.06, 0.3));
    engine?.setProgress("titleGlow", 0.3);
    engine?.setProgress("titleVisible", v < 0.5 ? 1 : 0);
  });

  // 标题/画布矩形 -> GL
  useEffect(() => {
    if (status !== "full" || !engine) return;
    const cleanups: Array<() => void> = [];
    if (titleRef.current) {
      cleanups.push(
        trackElement(titleRef.current, (r) => {
          engine.setProgress("titleRect.x", r.x);
          engine.setProgress("titleRect.y", r.y);
          engine.setProgress("titleRect.w", r.w);
          engine.setProgress("titleRect.h", r.h);
        })
      );
    }
    return () => {
      for (const c of cleanups) c();
    };
  }, [engine, status]);

  // Hero 内容退场(位移与透明度分层)
  const exitP = useTransform(p, (v) => seg(v, 0.3, 0.45));
  const heroY = useTransform(exitP, (v) => v * -80);
  const heroOpacity = useTransform(exitP, (v) => 1 - v);
  // 画布登场:四条发丝线 scale 合拢
  const frameP = useTransform(p, (v) => seg(v, 0.42, 0.58));
  // prompt 打字
  const typeP = useTransform(p, (v) => seg(v, 0.58, 0.95));

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <motion.div style={{ y: heroY }} className="text-center">
        <motion.div style={{ opacity: heroOpacity }}>
          <h1
            ref={titleRef}
            className={`mx-auto max-w-4xl text-balance font-serif text-5xl font-medium leading-[1.1] tracking-tight md:text-7xl ${
              status === "full" ? "text-transparent" : ""
            }`}
          >
            {t("title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>
        </motion.div>
      </motion.div>
      {/* 画布主角登场位(与 GenerateScene 的 figure 同规格同位置) */}
      <CanvasFrame frameP={frameP} />
      <PromptLine typeP={typeP} locale={locale} />
    </div>
  );
}

function CanvasFrame({ frameP }: { frameP: MotionValue<number> }) {
  const scaleX = useTransform(frameP, (v) => Math.min(1, v * 2));
  const scaleY = useTransform(frameP, (v) => Math.max(0, Math.min(1, v * 2 - 1)));
  const opacity = useTransform(frameP, (v) => (v > 0 ? 1 : 0));
  return (
    <motion.div
      style={{ opacity }}
      className="absolute left-1/2 top-1/2 aspect-square w-[min(52vh,480px)] -translate-x-1/2 -translate-y-1/2"
    >
      {/* 上下横线随 scaleX 合拢,左右竖线随 scaleY */}
      <motion.span style={{ scaleX }} className="absolute inset-x-0 top-0 h-px origin-center bg-border" />
      <motion.span style={{ scaleX }} className="absolute inset-x-0 bottom-0 h-px origin-center bg-border" />
      <motion.span style={{ scaleY }} className="absolute inset-y-0 left-0 w-px origin-center bg-border" />
      <motion.span style={{ scaleY }} className="absolute inset-y-0 right-0 w-px origin-center bg-border" />
    </motion.div>
  );
}

function PromptLine({
  typeP,
  locale,
}: {
  typeP: MotionValue<number>;
  locale: string;
}) {
  const t = useTranslations("Cinema");
  const full = t("promptSample");
  const [shown, setShown] = useState("");
  useMotionValueEvent(typeP, "change", (v) => {
    const chars = Array.from(full);
    setShown(chars.slice(0, Math.round(v * chars.length)).join(""));
  });
  const opacity = useTransform(typeP, (v) => (v > 0 ? 1 : 0));
  return (
    <motion.p
      style={{ opacity }}
      lang={locale}
      className="absolute bottom-[18vh] left-1/2 w-[min(80vw,560px)] -translate-x-1/2 text-center font-mono text-sm text-muted-foreground"
    >
      <span aria-hidden="true">&gt; </span>
      {shown}
      <span className="ml-0.5 inline-block h-4 w-[7px] animate-pulse bg-foreground align-middle" />
    </motion.p>
  );
}
```

标题显影 pass 的挂载（demo/首页 client effect，在字体就绪后）：

```tsx
useEffect(() => {
  if (!engine || !titleText) return;
  let disposed = false;
  renderTextTexture(titleText, {
    fontPx: 96,
    width: 1536,
    height: 512,
    color: "#1a1a1a",
  }).then((canvas) => {
    if (!disposed) {
      engine.addPass(
        createDenoisePass(canvas, {
          rect: "titleRect",
          p: "titleP",
          glow: "titleGlow",
          visible: "titleVisible",
        })
      );
    }
  });
  return () => {
    disposed = true;
  };
}, [engine, titleText]);
```

注意:标题纹理为深色字+透明底,denoise 着色器的"噪场底色"对文字纹理不适用
——本 Task 在着色器加 `uniform float uTextMode`（1 时未显影区域输出透明而非噪场,
即 `col = img; outColor = vec4(col, reveal * texture(uImage, local).a)`）,
工厂第三参 `textMode = false`。实现时把该分支写入 FS 并从 keys 工厂透传。

- [ ] **Step 5: 新增 Cinema i18n key（两文件同步）**

`apps/web/messages/en.json` 与 `zh.json` 增加命名空间:

```json
"Cinema": {
  "promptSample": "A porcelain teacup on rice paper, ink wash, morning light",
  "finaleHint": "The next one is yours to generate"
}
```

```json
"Cinema": {
  "promptSample": "宣纸上的白瓷茶盏，水墨风，晨光",
  "finaleHint": "下一张，由你来生成"
}
```

- [ ] **Step 6: demo 挂 OpeningScene，浏览器验收**

- opening 5%:墨溅粒子可见(截图对比);
- 20%:标题字形从噪点显影(full 态)/DOM 直显(lite);
- 50%:画布四边线合拢成形;
- 80%:prompt 已打出过半,光标闪烁;
- 滚回 20%:标题回到半显影(倒放)。

- [ ] **Step 7: typecheck + lint + Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/ apps/web/messages/
git commit -m "feat(web): cinema 序幕 -- 墨溅粒子/标题墨渗显影/画布登场/prompt 打字" -m "粒子位置为进度纯函数保证倒放;标题 GL 显影底层保留真实 DOM 字(SEO);denoise pass 扩展 keys 多实例复用。"
```

---

### Task 7: 2.5D 推轨 pass + 转场 A 穿越 + 第三幕宣言墨章

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/dolly.ts`
- Create: `apps/web/src/features/marketing/components/cinema/transitions.tsx`（本 Task 先落 ZoomThrough，B/C 在 Task 9/10 补入同文件）
- Create: `apps/web/src/features/marketing/components/cinema/scene-manifesto.tsx`
- Create: `apps/web/public/cinema/artwork-hero-depth.webp`（深度图，Step 2）
- Modify: demo 路由

**Interfaces:**
- Consumes: 前序全部原语；`useCinema().setTakeover`。
- Produces:
  - `createDollyPass(image: TexImageSource, depth: TexImageSource): CinemaPass`——读键：`dollyZoom`（1-18）、`dollySmear`（0-1）、`dollyDark`（0-1）、`dollyVisible`。全屏绘制（穿越期间画布即全世界）。
  - `<ZoomThroughTransition />`：dive 幕进度映射 uniforms 并管理 takeover；
  - `<ManifestoScene />`：墨底章节，白衬线逐字扫描（幕内进度驱动，词/字级 activation 同 how-it-works 的 stepActivation 手法）。

**dolly 着色器核心（完整 GLSL 片段函数体）:**

```glsl
#version 300 es
precision highp float;
uniform vec2 uSize;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform float uZoom;
uniform float uSmear;
uniform float uDark;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  uv.y = 1.0 - uv.y;
  vec2 c = vec2(0.5);
  vec2 dir = uv - c;
  float depth = texture(uDepth, c + dir / uZoom).r;
  // 深度视差:近处(depth 大)放大更快,产生层间推轨
  vec2 zuv = c + dir / (uZoom * (1.0 + (depth - 0.5) * 0.35));
  vec3 acc = vec3(0.0);
  // 径向拖影:向中心 8 次采样
  for (int k = 0; k < 8; k++) {
    float f = float(k) / 8.0 * uSmear * 0.35;
    acc += texture(uImage, mix(zuv, c, f)).rgb;
  }
  vec3 col = acc / 8.0;
  col = mix(col, vec3(0.055, 0.055, 0.05), uDark);
  outColor = vec4(col, 1.0);
}
```

pass 包装结构与 denoise 相同（编译/定位/render 读 `dollyVisible` 门/纹理两张分绑
TEXTURE0/1/dispose），此处不重复模板——照 denoise.ts 的包装写即可，
uniform 名单：`uSize/uImage/uDepth/uZoom/uSmear/uDark`。

- [ ] **Step 1: 实现 dolly.ts**（按上述 GLSL 与包装模板）

- [ ] **Step 2: 深度图资产**

为 artwork-hero 生成同尺寸灰度深度图 `artwork-hero-depth.webp`：主体亮(近)、
背景暗(远)的手绘径向渐变即可满足分层推轨需要——浏览器 canvas 画
`radialGradient(中心白 -> 边缘 30% 灰)` 导出。后续可换离线深度估计产物。

- [ ] **Step 3: transitions.tsx 落 ZoomThroughTransition**

```tsx
// apps/web/src/features/marketing/components/cinema/transitions.tsx
"use client";

/**
 * 三大转场的进度编排(GL uniform 驱动,自身无可见 DOM)。
 * ZoomThrough:镜头扎进画面,深度推轨+径向拖影+压暗,末端交给墨章。
 * takeover 仅在转场窗口内开启(窗口内无可交互内容)。
 */
import { useMotionValueEvent } from "framer-motion";
import { useCinema } from "./cinema-gl";
import { useSceneProgress } from "./cinema-stage";

/** easeInCubic:穿越要有"扎进去"的加速度 */
const easeIn = (t: number) => t * t * t;

export function ZoomThroughTransition() {
  const p = useSceneProgress("dive");
  const { engine, setTakeover } = useCinema();
  useMotionValueEvent(p, "change", (v) => {
    const active = v > 0.001 && v < 0.999;
    setTakeover(active);
    engine?.setProgress("dollyVisible", active ? 1 : 0);
    engine?.setProgress("dollyZoom", 1 + easeIn(v) * 17);
    // 拖影在中段最强,进出为零
    engine?.setProgress("dollySmear", 1 - Math.abs(v * 2 - 1));
    // 末端 30% 压暗到墨色,与宣言章底色 #0e0e0d 咬合
    engine?.setProgress("dollyDark", Math.max(0, (v - 0.7) / 0.3));
  });
  return null;
}
```

- [ ] **Step 4: 实现 scene-manifesto.tsx**

```tsx
// apps/web/src/features/marketing/components/cinema/scene-manifesto.tsx
"use client";

/**
 * 第三幕:墨底宣言章。白衬线大字逐字点亮(字符窗口 activation),
 * 中央反转呼吸光晕。文案沿用 Manifesto 现有双语内联 copy 的内容
 * (实现前与 manifesto-section.tsx 核对原文,逐字迁移,不改一字)。
 */
import { type MotionValue, motion, useTransform } from "framer-motion";
import { useLocale } from "next-intl";
import { useSceneProgress } from "./cinema-stage";

function charActivation(p: number, index: number, total: number): number {
  // 字符 i 的点亮窗口:[i/total * 0.8, i/total * 0.8 + 0.2]
  const start = (index / total) * 0.8;
  return Math.max(0, Math.min(1, (p - start) / 0.2));
}

export function ManifestoScene() {
  const p = useSceneProgress("manifesto");
  const locale = useLocale();
  const zh = locale.startsWith("zh");
  // 与 manifesto-section.tsx 现文案逐字一致(实现时替换本占位说明)
  const text = zh
    ? "从 manifesto-section 迁移的中文宣言原文"
    : "The manifesto copy migrated verbatim from manifesto-section";
  const units = zh ? Array.from(text) : text.split(" ");
  return (
    <div className="flex h-full items-center justify-center bg-[#0e0e0d]">
      {/* 反转呼吸光晕(白,极弱) */}
      <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.06] blur-3xl motion-safe:animate-[breathe_8s_ease-in-out_infinite]" />
      <p className="relative mx-auto max-w-3xl px-6 text-center font-serif text-3xl font-medium leading-[1.6] text-white md:text-5xl md:leading-[1.5]">
        {units.map((u, i) => (
          <ScrubUnit
            key={`${u}-${i}`}
            unit={u}
            index={i}
            total={units.length}
            progress={p}
            spaced={!zh}
          />
        ))}
      </p>
    </div>
  );
}

function ScrubUnit({
  unit,
  index,
  total,
  progress,
  spaced,
}: {
  unit: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
  spaced: boolean;
}) {
  const opacity = useTransform(progress, (v) =>
    0.14 + charActivation(v, index, total) * 0.86
  );
  return (
    <motion.span style={{ opacity }} className="inline">
      {unit}
      {spaced ? " " : ""}
    </motion.span>
  );
}
```

- [ ] **Step 5: demo 串联 opening -> generate -> dive -> manifesto 四幕联调**

验收点：
- dive 20%-80%:GL 全屏接管(canvas data-takeover="true"),画面放大+拖影;
- dive 95%:画面近黑,与 manifesto 章底色无缝;
- manifesto 腹地:白字逐字点亮;滚回 dive 中段画面重新亮起(倒放);
- takeover 在 dive 窗口外为 false(正文可交互)。

- [ ] **Step 6: typecheck + lint + Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/ apps/web/public/cinema/
git commit -m "feat(web): cinema 穿越转场与宣言墨章" -m "深度视差推轨+径向拖影+末端压暗与墨章底色咬合;takeover 仅转场窗口内接管;宣言逐字点亮沿用字符窗口 activation。"
```

---

### Task 8: 墨水流体 pass（反转质感层）

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/gl/passes/fluid.ts`
- Modify: `transitions.tsx`（ZoomThrough 末端喂 fluid 键）

**Interfaces:**
- Consumes: engine 原语；`EXT_color_buffer_float` 扩展探测。
- Produces: `createFluidPass(): CinemaPass | null`——扩展不可用返回 null（跳过，遮罩纯净版反转仍成立）。读键：`fluidP`（0-1 反转覆盖进度）、`fluidVisible`。`isLive()` 在可见且能量未耗尽时返回 true（引擎持续出帧）。

**实现要点（完整结构，实现时按此落码）:**

- 四分之一分辨率两张 ping-pong RGBA16F FBO：`velocity`、`dye`；
- 每帧序列：`advect(velocity)` -> 按 `fluidP` 检查点注入 splat（中心向外 8 向脉冲，
  进度过 0.1/0.3/0.5 各注一次，注入与否由已注入计数决定——半确定性，
  质感层允许）-> `divergence` -> `pressure` Jacobi 14 次 -> `subtractGradient`
  -> `advect(dye, 耗散 0.985)`；
- 合成：`coverage = max(dye.r, radialMask(uv, fluidP))`，
  `radialMask = smoothstep(r+0.12, r-0.05, dist)`，`r = fluidP * 0.85`；
  输出 `vec4(inkColor, coverage)`，inkColor 与宣言章底色一致 `#0e0e0d`；
- WHY 遮罩兜底：布局真相由 radialMask 保证（fluidP=1 必然全覆盖），
  流体 dye 只负责边缘的涡卷质感——滚动倒放时遮罩精确可逆，
  dye 残留随耗散消散，符合设计稿"质感层允许非确定"；
- tier 1 时压力迭代降为 8 次、分辨率降至 1/6；
- ZoomThrough 修改：`engine.setProgress("fluidP", Math.max(0, (v - 0.55) / 0.45))`
  与 `fluidVisible`（dive 与 manifesto 前 10% 窗口内为 1）。

GLSL 程序共 6 个（advect/splat/divergence/pressure/gradient/composite），
每个 10-20 行标准 stable-fluids 实现；文件预计 300 行。喷注方向与强度全部由
常量表定义（无 Math.random——确定性检查点脉冲）。

- [ ] **Step 1: 实现 fluid.ts**（按上述要点，六程序 + ping-pong FBO + isLive）
- [ ] **Step 2: ZoomThrough 接入 fluid 键**
- [ ] **Step 3: demo 验收**

- dive 60% 起视口边缘出现墨的涡卷侵入,与径向遮罩叠加;
- dive 100% 全覆盖,进入 manifesto 无缝;
- 快速滚回:遮罩立即退回(布局可逆),残留 dye 数百毫秒内耗散;
- DevTools Performance:滚动中无 >50ms 长任务(流体在 quarter-res)。

- [ ] **Step 4: typecheck + lint + Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(web): cinema 墨水流体反转质感层" -m "quarter-res stable-fluids+确定性检查点脉冲;radialMask 保证布局真相可逆,dye 只做涡卷边缘;扩展缺失时纯遮罩降级。"
```

---

### Task 9: 几何纯函数 + 转场 B 增殖（粒子 morph 重凝网格）

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/cinema-geometry.ts`
- Test: `apps/web/src/features/marketing/components/cinema/cinema-geometry.test.ts`
- Create: `apps/web/src/features/marketing/components/cinema/scene-multiply.tsx`（增殖幕：粒子 + DOM 网格重凝 + 底色回纸白）
- Create: `apps/web/public/cinema/wall/`（展墙样张 8-16 张，Step 3）
- Modify: `transitions.tsx`（MultiplyTransition 进度编排）、demo 路由

**Interfaces:**
- Consumes: Task 6 `createParticlesPass`（morph 模式键：`splashMode=1`、`morphP`、`morphRectA.*`）。
- Produces（cinema-geometry.ts，全部纯函数）:
  - `centerSquareRect(vw: number, vh: number): ViewportRect`——画布主角规格（`min(0.52*vh, 480px)` 方形居中）的视口分数；序幕/增殖/终幕共用同一构图事实。
  - `gridPos(i: number, vw: number, vh: number): { x: number; y: number; w: number; h: number }`——4x4 满视口网格第 i 格（含 24px 缝）。
  - `stripPos(i: number, count: number, vw: number, vh: number): { x: number; y: number; w: number; h: number; trackWidth: number }`——展墙横条第 i 格（高 52vh、宽 0.36vw、缝 0.06vw、垂直交错 ±4vh）。
  - `mixRect(a, b, t): ViewportRect`——两矩形线性插值（转场 B 末端 DOM 网格接管、转场 C 选中回中共用）。

- [ ] **Step 1: 写几何纯函数失败测试**

```ts
// cinema-geometry.test.ts
import { describe, expect, it } from "vitest";
import {
  centerSquareRect,
  gridPos,
  mixRect,
  stripPos,
} from "./cinema-geometry";

describe("cinema-geometry", () => {
  it("centerSquareRect 居中且不超 480px", () => {
    const r = centerSquareRect(2000, 1000);
    expect(r.w * 2000).toBeCloseTo(480, 5);
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 10);
    expect(r.y + r.h / 2).toBeCloseTo(0.5, 10);
  });

  it("gridPos 16 格均匀铺满且不重叠", () => {
    const a = gridPos(0, 1600, 900);
    const b = gridPos(5, 1600, 900);
    expect(a.x).toBeLessThan(b.x);
    expect(a.y).toBeLessThan(b.y);
    expect(a.x + a.w).toBeLessThanOrEqual(b.x + 1e-9 + 1);
  });

  it("stripPos x 随 i 单调递增,trackWidth 一致", () => {
    const p0 = stripPos(0, 16, 1600, 900);
    const p1 = stripPos(1, 16, 1600, 900);
    expect(p1.x).toBeGreaterThan(p0.x);
    expect(p0.trackWidth).toBe(p1.trackWidth);
  });

  it("mixRect 端点恒等", () => {
    const a = { x: 0, y: 0, w: 1, h: 1 };
    const b = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(mixRect(a, b, 0)).toEqual(a);
    expect(mixRect(a, b, 1)).toEqual(b);
  });
});
```

- [ ] **Step 2: 实现 cinema-geometry.ts 使测试通过**（实现按接口语义直写，全部
  为 20 行内的算术函数；`gridPos` 缝 24px 换算视口分数，`stripPos` 垂直交错
  `y = 0.5 - h/2 + (i % 2 === 0 ? -0.045 : 0.045)`）。跑测试确认 PASS。

- [ ] **Step 3: 展墙样张资产**

从 `apps/web/public/` 现有营销素材挑至多 16 张复制入 `public/cinema/wall/`
（命名 `w01.webp` 起）。不足 16 张时以 artwork-hero 的 CSS 滤镜变体补
（`grayscale`/`contrast` 组合在 DOM 层实现，不生成新文件）。

- [ ] **Step 4: 实现 scene-multiply.tsx 与 MultiplyTransition**

```tsx
// scene-multiply.tsx 核心结构(完整实现按此展开)
// 1) MultiplyTransition(transitions.tsx 内):
//    useMotionValueEvent(useSceneProgress("multiply"), "change", v => {
//      engine?.setProgress("splashMode", 1);
//      engine?.setProgress("morphP", v);
//      const r = centerSquareRect(innerWidth, innerHeight);
//      engine?.setProgress("morphRectA.x", r.x); ...y/w/h
//    });
// 2) 底色回纸白:幕内 motion div,backgroundColor 函数式
//    useTransform(p, v => `rgba(14,14,13,${1 - v})`)——纯样式层,单独节点。
// 3) DOM 网格:16 个 figure 绝对定位于 gridPos(i),
//    整体 opacity = useTransform(p, v => Math.max(0, (v - 0.82) / 0.18))
//    ——粒子重凝完成前不可见,完成时无缝接管(粒子 p>=1 即停绘,见 Task 6)。
//    figure 内 img 来自 /cinema/wall/,object-cover,边框 border-border。
```

- [ ] **Step 5: demo 验收**

- multiply 10%-80%:图像粒子云从中心矩形散开并向 16 格聚拢,底色由墨转白;
- 85% 后:DOM 网格接管,与粒子终位对齐无跳变(截图对比 gridPos 计算值);
- 滚回:网格隐去,粒子逆向归拢(倒放成立)。

- [ ] **Step 6: typecheck + lint + 测试 + Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/ apps/web/public/cinema/wall/
git commit -m "feat(web): cinema 增殖转场 -- 粒子 morph 重凝 16 格网格" -m "几何纯函数统一构图事实(序幕/增殖/终幕同源);粒子终位与 DOM gridPos 对齐保证接管无跳变;底色墨转纸白随重凝完成。"
```

---

### Task 10: 第四幕展墙 + 转场 C 选中回中

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/scene-wall.tsx`
- Modify: `transitions.tsx`（PickAndReturnTransition）、demo 路由

**Interfaces:**
- Consumes: Task 9 `gridPos`/`stripPos`/`mixRect`/`centerSquareRect`；`useSceneProgress("wall")`、`useSceneProgress("pick")`；Testimonials i18n（低语文案，实现前 grep testimonials.tsx 核对 key/内联 copy）。
- Produces: `<WallScene />`（含 pick 幕编排；被选中项 index 固定为 7——横条视觉中段）。

- [ ] **Step 1: 实现 scene-wall.tsx**

```tsx
// scene-wall.tsx 核心编排(完整实现按此展开):
// 每个 figure 的矩形 = 三段进度合成,全部函数式 useTransform:
//   const wallP = useSceneProgress("wall");
//   const pickP = useSceneProgress("pick");
//   rect(i) 计算:
//     spread = clamp(wallP / 0.15)            // 0-0.15: 网格拉开成横条
//     glide  = clamp((wallP - 0.15) / 0.85)   // 0.15-1: 横条整体左移
//     base   = mixRect(gridPos(i), stripPos(i), easeInOut(spread))
//     base.x -= glide * (trackWidth - 1)      // 归一化轨道位移
//     pick 幕:i === 7 时 rect 再 mixRect(base, centerSquareRect, easeInOut(pickP)),
//             其余项 opacity = 1 - pickP、y 随 pickP 微散(±3vh, 方向按 i 奇偶)。
//   绑定:x/y/width/height 分别 useTransform 计算 px 值,
//   位移用 transform(x/y),尺寸用 width/height 直绑——尺寸变化仅 pick 幕
//   单元素发生,布局成本可接受;透明度绑内层(分层铁律)。
// 铭牌:每 figure 下沿衬线小字 [罗马数字] + UseCases 标题(key 数不足则只有数字);
// 低语:Testimonials 引言取 3 条,绝对定位于 stripPos 缝隙
//   (i=3/8/12 之后),italic text-white/60?——注意此时底色已回纸白,
//   用 text-muted-foreground italic;随 glide 与所在缝隙同速移动。
// step03 刻度:左下 uppercase 小字 "03 / export" 复用 HowItWorks key。
```

- [ ] **Step 2: demo 验收**

- wall 0-15%:16 格平滑拉开成横条(无跳变);
- wall 50%:横条已左移过半,各 figure 垂直交错与低语随行;
- pick 100%:第 7 格居中为画布规格矩形,其余淡出;
- 滚回 wall 5%:回到近似 4x4 网格(倒放成立)。

- [ ] **Step 3: typecheck + lint + Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(web): cinema 展墙推轨与选中回中" -m "gridPos/stripPos 三段进度合成单一矩形事实,拉开-推轨-选中全程连续可倒放;评价转观展低语,四步刻度沿用 HowItWorks key。"
```

---

### Task 11: 终幕 bookend + CinemaFilm 装配 + 静态编排版

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/scene-finale.tsx`
- Create: `apps/web/src/features/marketing/components/cinema/static-film.tsx`
- Create: `apps/web/src/features/marketing/components/cinema/cinema-film.tsx`
- Create: `apps/web/src/features/marketing/components/cinema/index.ts`
- Modify: demo 路由（全片串联）

**Interfaces:**
- Consumes: 全部前序原语；CTASection 的 i18n key（实现前 grep cta-section.tsx 核对）；`Cinema.finaleHint`。
- Produces:
  - `<CinemaFilm />`：`CinemaGLProvider` + 探测分流（static -> `<StaticFilm />`；else `<CinemaStage>` 七幕 + 三转场）+ pass 装载 effect（denoise x2 / particles / dolly / fluid，资产解码后注册）。
  - `<FinaleStage />`：独立 200vh sticky 舞台（自有 useScroll），反向显影 + 白罩收纸 + finaleHint + CTA 按钮 + 尾墨滴；static 态渲染静态 CTA 块。
  - `<StaticFilm />`：全部内容的静态编辑部编排（标题/副行/CTA、卖点列表、宣言、步骤 01-04、样张 4x4 网格、引言、终幕语），无滚动驱动，沿用全部 i18n key——`static` 态与无 JS 首屏的内容真相。

- [ ] **Step 1: scene-finale.tsx**

```tsx
// 核心编排:
// finaleP 窗口: 反向显影 [0,0.5](denoise 实例 keys=finale*,p = 1 - seg(v,0,0.5),
//   visible 门在窗口内) -> 白罩收纸 [0.4,0.65](motion div bg-background,
//   opacity 函数式 0->1,盖过残噪) -> 光标+finaleHint+CTA [0.6,1]
//   (打字光标复用 OpeningScene 的样式;CTA 按钮真实 Link,SEO/可点) ->
//   尾墨滴 [0.85,1](splash keys 窗口无重叠,直接复用 splashP)。
// 构图:画布矩形 = centerSquareRect —— 与序幕同位同尺寸(bookend)。
```

- [ ] **Step 2: static-film.tsx**（全部内容静态排版；结构为既有营销静态组件的
  编辑部重排，标题层级与 token 沿用站点规范；样张网格用 /cinema/wall/ 资产）

- [ ] **Step 3: cinema-film.tsx 装配 + index.ts 桶导出**

```tsx
// cinema-film.tsx 关键点:
// "use client";动态导入由页面侧 next/dynamic 完成(ssr: false 不允许于
// Server Component——用 client 包装文件 re-export,Next 16 惯例);
// FilmBody 读 useCinema().status:
//   static -> <StaticFilm />
//   else -> <CinemaStage> <SceneLayer scene=...>各幕</SceneLayer>
//           <ZoomThroughTransition/><MultiplyTransition/> </CinemaStage>
// pass 装载 effect:两图(artwork/depth) decode + renderTextTexture(标题)后
//   engine.addPass(...) 一次性注册;卸载由 provider dispose 兜底。
// IntersectionObserver:CinemaStage 与 FinaleStage 根元素进出视口
//   engine.setActive(可见) ——静默谷 GL 休眠。
```

- [ ] **Step 4: demo 全片串联走查（七幕 + 终幕 + 谷段占位）**，验收全部前序
  Task 的验收点在串联态复测一遍，重点看幕交界与 takeover 时序。

- [ ] **Step 5: typecheck + lint + Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "feat(web): cinema 终幕 bookend 与全片装配/静态编排版" -m "反向显影收纸+尾墨滴与序幕同构图闭环;CinemaFilm 探测分流三层;StaticFilm 承载 static 态与内容真相。"
```

---

### Task 12: 墨线系统 + 首页集成 + 旧组件退役

**Files:**
- Create: `apps/web/src/features/marketing/components/cinema/ink-thread.tsx`
- Modify: `apps/web/src/app/[locale]/(marketing)/page.tsx`
- Modify: `apps/web/src/features/marketing/components/index.ts`
- Delete: `how-it-works.tsx`、`testimonials.tsx`、`hero-section.tsx`、`feature-grid.tsx`、`manifesto-section.tsx`、`use-cases-section.tsx`、`cta-section.tsx`（内容已全部迁入 cinema 各幕；删除前 `grep -r "组件名" apps/web/src` 确认无其余引用）

**Interfaces:**
- Consumes: HowItWorks steps i18n key（章节刻度）。
- Produces: `<InkThread step={n} numeral="IV" side="left" />`——谷段页边墨线段：SVG path `strokeDashoffset` 随自身 useScroll（`offset: ["start end", "end start"]`）扫描生长，衬线罗马数字与 step 文案随线尾点亮；`motion-reduce`/static 态直接呈现完成态。

- [ ] **Step 1: 实现 ink-thread.tsx**

```tsx
// ink-thread.tsx 核心(完整实现按此展开):
// <svg viewBox="0 0 24 400" class="absolute left-6 h-full w-6 md:left-10">
//   <motion.path d="M12 0 V 400" pathLength={1}
//     style={{ pathLength: scrub }} stroke="currentColor" strokeWidth={1} />
// </svg>
// scrub = useScroll({ target: selfRef, offset: ["start end", "end start"] })
//   .scrollYProgress 经函数式 useTransform 钳制;
// 数字与文案:线体旁 sticky 定位的
//   <span class="text-[11px] uppercase tracking-widest text-muted-foreground">
//     {numeral} · {t(`steps.${key}.title`)}</span>
//   opacity 随 scrub > 0.5 点亮(函数式);
// framer-motion pathLength 本身即 stroke-dash 控制,无需手写 dashoffset。
```

- [ ] **Step 2: 首页集成（page.tsx 区块替换）**

```tsx
// page.tsx 修改(保留数据获取与 SLA/Pricing/FAQ 的既有 props 传递):
import dynamic from "next/dynamic";
// CinemaFilm 为 client 组件,直接静态 import 即可(其内部 GL 引擎按需初始化;
// Next 16 会把它放入客户端 bundle,营销页本就含 framer-motion)。
import {
  CinemaFilm,
  FinaleStage,
  InkThread,
} from "@/features/marketing/components/cinema";

// 区块顺序:
// <CinemaFilm />                                  // 七幕影片(原 Hero..Testimonials)
// <section class="relative"> <InkThread numeral="V" step="export" side="left" />
//   <SlaStatusSection ... /> </section>            // 静默谷一
// <PricingSection ... />                           // 第五幕装裱(交互原样)
// <section class="relative"> <InkThread numeral="VI" step="completion" side="right" />
//   <FAQSection /> </section>                      // 静默谷二
// <FinaleStage />                                  // 终幕(原 CTASection)
```

PricingSection 本 Task 仅做"装裱"语义包装：眉题文案上方加
`text-[11px] uppercase tracking-widest` 的 "Framing / 装裱规格" 眉标
（Cinema 命名空间新增 `framingLabel` key，en/zh 同步），其余不动。

- [ ] **Step 3: 旧组件退役**

- `grep -rn "HeroSection\|FeatureGrid\|ManifestoSection\|HowItWorks\|UseCasesSection\|Testimonials\|CTASection" apps/web/src --include="*.tsx" --include="*.ts"` 确认仅 index.ts 与 page.tsx 引用；
- 删除七个组件文件与 index.ts 对应导出行；`reveal.tsx`/`scroll-fx.tsx` 若仍被 pseo 或 cinema 引用则保留（grep 决定）；
- i18n key 不删除：Hero/Features/HowItWorks/Testimonials/UseCases/CTA 命名空间的 key 已由 cinema 各幕消费，messages 文件零改动（Cinema 命名空间除外）。

- [ ] **Step 4: 首页走查（/zh 与 /en）**

- 首屏 LCP 元素为序幕真实 DOM 标题（View Source 可见全部正文）；
- 影片全程滚动一遍,幕交界/takeover/谷段墨线各自正确；
- Pricing 交互（切换/跳转）不回归；FAQ 折叠不回归；
- `pnpm --filter @repo/web exec tsc --noEmit` 0 错误。

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/features/marketing/ "apps/web/src/app/[locale]/(marketing)/page.tsx" apps/web/messages/
git commit -m "feat(web): 首页切换影片化滚动并退役旧区块组件" -m "七幕影片+墨线谷段+终幕 bookend 接管首页;旧 Hero/Features/宣言/四步/UseCases/评价/CTA 组件内容全数迁入各幕后删除;i18n key 全部保留消费。"
```

---

### Task 13: 三层回退核验 + 性能走查

**Files:**
- Modify: `cinema-gl.tsx`（增加 dev 专用强制降级参数：`?gl=lite|static`，仅
  `process.env.NODE_ENV !== "production"` 时读取 `location.search`）
- Modify: 各幕组件中经走查发现的回退缺口（以走查结论为准，逐项小修）

- [ ] **Step 1: probeInitialStatus 增加 dev 强制参数**

```ts
// probeInitialStatus 开头插入:
if (process.env.NODE_ENV !== "production") {
  const forced = new URLSearchParams(window.location.search).get("gl");
  if (forced === "lite" || forced === "static") return forced;
}
```

- [ ] **Step 2: 三层走查（Playwright）**

- full：`/zh` 全程滚动，`browser_console_messages` 无错误；
- lite：`/zh?gl=lite`——画布不存在、去噪为 CSS 噪点+模糊衰减、转场为纯
  transform/opacity 简化（各转场组件在 `status !== "full"` 时的分支由本步
  查缺补漏：ZoomThrough 退化为整层 scale+压暗、Multiply 退化为网格直接
  fade-in、fluid 无、粒子无）；内容完整可读；
- static：`/zh?gl=static`——StaticFilm 文档流排版，无 sticky 行程；
  再以 Playwright 设备仿真 375px 宽复测真实移动端命中 static；
- reduced-motion：CDP `Emulation.setEmulatedMedia` 置 `prefers-reduced-motion: reduce` 复测命中 static。

- [ ] **Step 3: 性能核验（full 态）**

Playwright evaluate 注入：

```js
() => new Promise((resolve) => {
  const longTasks = [];
  new PerformanceObserver((list) => longTasks.push(...list.getEntries()))
    .observe({ type: "longtask", buffered: true });
  let y = 0;
  const step = () => {
    y += 24;
    window.scrollTo(0, y);
    if (y < document.body.scrollHeight - innerHeight) {
      requestAnimationFrame(step);
    } else {
      setTimeout(() => resolve(longTasks.map((t) => t.duration)), 500);
    }
  };
  requestAnimationFrame(step);
})
```

验收：全程 longtask 数量 <= 3 且单个 < 120ms（首帧解码豁免）；
如超标，按 pass 逐个 `enabled=false` 二分定位热点后优化（降采样/减迭代）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/marketing/components/cinema/
git commit -m "fix(web): cinema 三层回退查缺与性能收口" -m "dev 强制降级参数便于走查;lite 态转场简化分支补全;longtask 走查达标。"
```

---

### Task 14: 门禁 + 文档收尾 + 推送

**Files:**
- Delete: `apps/web/src/app/[locale]/(marketing)/demo/cinema/`（联调载体退役）
- Modify: `docs/TODO.md`（登记完成与后续项：真实扩散帧序列资产、深度图离线生成）
- Modify: `docs/plan/2026-07-10-homepage-cinema-design.md`（文末追加"完成情况"小节）
- Modify: `CHANGELOG.md`（未发布段新增影片化条目）

- [ ] **Step 1: 删除 demo 路由，grep 确认无引用**
- [ ] **Step 2: 全量门禁**

Run: `pnpm exec turbo typecheck && pnpm exec turbo lint && pnpm exec turbo test && pnpm exec turbo build`
Expected: typecheck/build 全绿；lint error 数不高于基线 13（全部为既有存量，
见 2026-07-10 门禁记录，cinema 目录必须 0 error）；test 失败集合不超出既有
flaky 名单（service-web-fallback 等，不得出现 cinema 相关新失败——
cinema 三个纯函数测试必须通过）。

- [ ] **Step 3: 文档更新 + Commit + push**

```bash
git add -A
git commit -m "docs(web): cinema 影片化收尾 -- 门禁记录/TODO/设计稿完成情况/CHANGELOG"
git push origin main
```

---

## Self-Review 记录

**Spec 覆盖核对（设计稿 v2 十一节 -> Task 映射）：**

| 设计稿条目 | Task |
|---|---|
| 渲染引擎七能力（去噪着色器/粒子/流体/2.5D/速度镜头/文字 GL/后处理） | 2/5/6/7/8；速度响应镜头见下方缺口说明 |
| 分镜八幕 + 三转场 + bookend | 5(第二幕)/6(序幕)/7(A+第三幕)/8(反转质感)/9(B)/10(第四幕+C)/11(终幕) |
| 墨线系统 | 12 |
| 三层回退阶梯 + 质量调控 | 2/3/11/13 |
| 资产策略（样张/深度图/展墙图集） | 5/7/9 |
| 功能与内容不变式（i18n/交互/SEO/DOM 真相） | 5/6/11/12 各幕 + 12 集成核验 |
| 验收六条 | 12(LCP/交互)/13(fps/回退/倒放)/14(门禁) |
| 旧组件退役 | 12 |

**已识别缺口（有意后置，登记 TODO 而非塞进本计划）：**
1. 速度响应镜头（scroll velocity -> 拖影 uniform）——设计稿能力 5：全片贯穿的
   触觉签名，依赖 useVelocity 与 dolly/denoise 的联动调参，放入 Task 13 之后的
   独立打磨迭代，避免首轮联调变量过多；
2. 真实扩散帧序列与离线深度图——接口已留（denoise 帧采样模式/uDepth），
   资产到位即换；
3. 展墙玻璃折射高光——Task 10 以 CSS 高光缓扫实现（设计稿允许 DOM 层实现），
   GL 折射版留作打磨迭代。

**Placeholder 扫描：** Task 6 denoise 的 uTextMode 分支、Task 9/10/11 的
"核心编排"块为带完整逻辑语义的实现指令（数值/键名/公式齐备），执行者无需
自行设计；FEATURE_KEYS/宣言原文/CTA key 三处标注了"实现前 grep 核对"——这是
对真实代码库的核对指令而非未决设计。无 TBD/TODO 残留。

**类型一致性：** `createDenoisePass(image, keys)` 在 Task 5 定义、Task 6 扩展
（DenoiseKeys 含 visible）、Task 11 finale 复用同签名；`ViewportRect` 由
dom-sync 定义并被 cinema-geometry 复用；progress 键名清单——
`master/opening/generate/dive/manifesto/multiply/wall/pick`（SceneLayer 自动）、
`canvasRect.*/denoiseP/denoiseGlow/denoiseVisible`、`titleRect.*/titleP/titleGlow/titleVisible`、
`splashMode/splashP/splashOx/splashOy`、`morphP/morphRectA.*`、
`dollyZoom/dollySmear/dollyDark/dollyVisible`、`fluidP/fluidVisible`、
`finale*`（denoise 第三实例）、`postGrain/postVignette`——各 Task 引用与此一致。

## 执行说明

- 任务顺序即依赖顺序（1 -> 14），不可跳序；
- 每 Task 的浏览器验收在 demo 路由（Task 12 起在首页）用 Playwright 落点复测，
  验收不过不得进入下一 Task；
- dev server 与 WSL postgres 沿用当前会话已运行实例（localhost:3000）。
