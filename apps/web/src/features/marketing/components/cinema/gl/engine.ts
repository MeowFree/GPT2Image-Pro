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
