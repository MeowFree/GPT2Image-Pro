/**
 * 墨水流体 pass:四分之一分辨率 stable-fluids 墨模拟 + 进度覆盖遮罩。
 * 反转转场的质感层:布局真相由 radialMask 保证(fluidP=1 必然全覆盖,
 * 滚动倒放时遮罩精确可逆);流体 dye 只负责边缘的涡卷质感,残留随耗散
 * 消散——质感层允许半确定性(检查点脉冲全由常量表定义,无随机)。
 * 需要 EXT_color_buffer_float(RGBA16F 可渲染);不可用时工厂返回 null,
 * 反转由 dolly 末端压暗与宣言章 DOM 底色兜底(纯遮罩版反转仍成立)。
 */
import {
  type CinemaPass,
  compileProgram,
  createTexture,
  FULLSCREEN_VS,
  type PassContext,
} from "../engine";

/** 半拉格朗日平流:沿速度场回溯采样,附耗散 */
const ADVECT_FS = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 back = uv - texture(uVelocity, uv).xy * uDt;
  outColor = vec4(texture(uSource, back).xyz * uDissipation, 1.0);
}`;

/** 检查点脉冲注入:中心向外 8 向高斯 splat,一次绘制注满一轮脉冲 */
const SPLAT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTarget;
uniform vec2 uTexel;
uniform float uMode;
uniform float uAngle0;
uniform float uStrength;
uniform float uRadius;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 acc = texture(uTarget, uv).xyz;
  for (int k = 0; k < 8; k++) {
    float ang = uAngle0 + float(k) * 0.785398;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 d = uv - (vec2(0.5) + dir * 0.06);
    float g = exp(-dot(d, d) / uRadius);
    acc += uMode < 0.5
      ? vec3(dir * uStrength * g, 0.0)
      : vec3(uStrength * g, 0.0, 0.0);
  }
  outColor = vec4(acc, 1.0);
}`;

/** 速度散度(中心差分) */
const DIVERGENCE_FS = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float l = texture(uVelocity, uv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uVelocity, uv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uVelocity, uv - vec2(0.0, uTexel.y)).y;
  float t = texture(uVelocity, uv + vec2(0.0, uTexel.y)).y;
  outColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`;

/** 压力 Jacobi 迭代:上一轮压力作初值(热启动,无需清场) */
const PRESSURE_FS = `#version 300 es
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float l = texture(uPressure, uv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, uv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, uv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, uv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergence, uv).x;
  outColor = vec4((l + r + b + t - div) * 0.25, 0.0, 0.0, 1.0);
}`;

/** 减压力梯度:得到无散速度场(不可压缩,产生涡卷) */
const GRADIENT_FS = `#version 300 es
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float l = texture(uPressure, uv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, uv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, uv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, uv + vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVelocity, uv).xy - 0.5 * vec2(r - l, t - b);
  outColor = vec4(vel, 0.0, 1.0);
}`;

/**
 * 合成:coverage = max(墨浓度, 径向遮罩)。遮罩是布局真相
 * (fluidP=1 时角点距离 0.707 < 0.85-0.05,必然全覆盖);
 * 墨色与宣言章底色一致(#0e0e0d)。
 */
const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uDye;
uniform vec2 uSize;
uniform float uP;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float r = uP * 0.85;
  float mask = smoothstep(r + 0.12, r - 0.05, distance(uv, vec2(0.5)));
  float dye = texture(uDye, uv).x;
  float coverage = clamp(max(dye, mask), 0.0, 1.0);
  outColor = vec4(0.055, 0.055, 0.051, coverage);
}`;

/** 检查点脉冲常量表:进度上穿即注入——全常量定义,倒放重进可复现 */
interface PulseDef {
  /** 触发进度检查点 */
  at: number;
  /** 8 向基准角(弧度),各次脉冲错开避免同向叠加 */
  angle0: number;
  /** 速度脉冲强度(uv/秒) */
  strength: number;
  /** 墨注入量 */
  dye: number;
  /** 高斯半径平方尺度(uv 平方) */
  radius: number;
}

const PULSES: readonly PulseDef[] = [
  { at: 0.1, angle0: 0, strength: 0.9, dye: 0.55, radius: 0.0028 },
  { at: 0.3, angle0: 0.26, strength: 1.4, dye: 0.75, radius: 0.0042 },
  { at: 0.5, angle0: 0.13, strength: 1.9, dye: 0.95, radius: 0.006 },
];

/** 速度场耗散:略低于 1 使涡旋最终静息(isLive 才会停帧) */
const VELOCITY_DISSIPATION = 0.998;
/** 墨场耗散(计划值 0.985):滚回后残留数百毫秒内显著消散 */
const DYE_DISSIPATION = 0.985;
/** 能量静息阈值:能量随墨同步衰减,低于此值停止连续出帧 */
const ENERGY_REST = 0.04;

/** 切换程序的唯一入口:biome 将 gl.useProgram 误判为 React hook */
function applyProgram(gl: WebGL2RenderingContext, prog: WebGLProgram): void {
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API 非 React hook
  gl.useProgram(prog);
}

/**
 * 一次性探测 EXT_color_buffer_float:1x1 临时上下文,探测后立即
 * 主动丢弃(WEBGL_lose_context),不与引擎主上下文长期并存;
 * 同机同驱动下扩展支持与主上下文一致。SSR 环境返回 false。
 */
function probeFloatColorBuffer(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext("webgl2");
  if (!gl) return false;
  const ok = gl.getExtension("EXT_color_buffer_float") !== null;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return ok;
}

/** 单个可渲染浮点纹理目标 */
interface FluidTarget {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

/** ping-pong 目标对:read 供采样,write 供写入,每步后互换 */
interface PingPong {
  read: FluidTarget;
  write: FluidTarget;
}

/** 程序与 uniform 位置缓存 */
interface ProgramInfo {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}

interface Programs {
  advect: ProgramInfo;
  splat: ProgramInfo;
  divergence: ProgramInfo;
  pressure: ProgramInfo;
  gradient: ProgramInfo;
  composite: ProgramInfo;
}

function buildProgram(
  gl: WebGL2RenderingContext,
  fsSource: string,
  names: readonly string[]
): ProgramInfo {
  const prog = compileProgram(gl, FULLSCREEN_VS, fsSource);
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) {
    loc[name] = gl.getUniformLocation(prog, name);
  }
  return { prog, loc };
}

/** RGBA16F 可渲染目标;分配或完整性检查失败返回 null(调用方降级) */
function createTarget(
  gl: WebGL2RenderingContext,
  w: number,
  h: number
): FluidTarget | null {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) {
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
    return null;
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // 半浮点核心可过滤(线性采样),可渲染性由 EXT_color_buffer_float 提供
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    w,
    h,
    0,
    gl.RGBA,
    gl.HALF_FLOAT,
    null
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0
  );
  const complete =
    gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    return null;
  }
  return { tex, fbo };
}

function deleteTarget(gl: WebGL2RenderingContext, t: FluidTarget): void {
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

function createPingPong(
  gl: WebGL2RenderingContext,
  w: number,
  h: number
): PingPong | null {
  const read = createTarget(gl, w, h);
  const write = createTarget(gl, w, h);
  if (!read || !write) {
    if (read) deleteTarget(gl, read);
    if (write) deleteTarget(gl, write);
    return null;
  }
  return { read, write };
}

function swap(pp: PingPong): void {
  const t = pp.read;
  pp.read = pp.write;
  pp.write = t;
}

/**
 * 创建墨水流体 pass;EXT_color_buffer_float 不可用返回 null(跳过)。
 * 读 progress 键:fluidP(0-1 反转覆盖进度)/fluidVisible(< 0.5 跳绘)。
 * 每帧序列:advect(velocity) -> 检查点 splat -> divergence ->
 * pressure Jacobi(满档 14 次,降档 8 次) -> subtractGradient ->
 * advect(dye, 耗散 0.985) -> 全屏合成(alpha 混合,预乘勘误直通)。
 * 分辨率:满档 1/4,降档 1/6。isLive 在可见且能量未耗尽时为 true。
 */
export function createFluidPass(): CinemaPass | null {
  if (!probeFloatColorBuffer()) return null;

  let programs: Programs | null = null;
  let velocity: PingPong | null = null;
  let dye: PingPong | null = null;
  let pressure: PingPong | null = null;
  let divergence: FluidTarget | null = null;
  /** 探测通过但分配失败时的纯遮罩兜底采样源(1x1 透明黑) */
  let dummyDye: WebGLTexture | null = null;
  let simReady = false;
  let allocW = 0;
  let allocH = 0;
  /** 已注入脉冲计数:进度上穿检查点即注入,下穿回收——半确定性 */
  let injected = 0;
  /** 能量:splat 置 1,随墨耗散同步衰减;静息后引擎停帧 */
  let energy = 0;
  let lastTimeMs = 0;
  let lastVisible = false;

  /** 释放全部模拟目标(尺寸/档位变化重建,或 dispose) */
  const releaseTargets = (gl: WebGL2RenderingContext): void => {
    for (const pp of [velocity, dye, pressure]) {
      if (pp) {
        deleteTarget(gl, pp.read);
        deleteTarget(gl, pp.write);
      }
    }
    if (divergence) deleteTarget(gl, divergence);
    velocity = null;
    dye = null;
    pressure = null;
    divergence = null;
    allocW = 0;
    allocH = 0;
  };

  /** 按画布尺寸与质量档位懒分配/重建模拟目标 */
  const ensureTargets = (
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    tier: number
  ): void => {
    const divisor = tier >= 2 ? 4 : 6;
    const sw = Math.max(2, Math.round(width / divisor));
    const sh = Math.max(2, Math.round(height / divisor));
    if (allocW === sw && allocH === sh) return;
    releaseTargets(gl);
    const v = createPingPong(gl, sw, sh);
    const d = createPingPong(gl, sw, sh);
    const pr = createPingPong(gl, sw, sh);
    const dv = createTarget(gl, sw, sh);
    if (!v || !d || !pr || !dv) {
      // RGBA16F 实际不可渲染:释放已建部分,退纯遮罩模式(布局仍成立)
      for (const pp of [v, d, pr]) {
        if (pp) {
          deleteTarget(gl, pp.read);
          deleteTarget(gl, pp.write);
        }
      }
      if (dv) deleteTarget(gl, dv);
      simReady = false;
      return;
    }
    velocity = v;
    dye = d;
    pressure = pr;
    divergence = dv;
    allocW = sw;
    allocH = sh;
    // 新纹理零初始化:场从静水开始,注入计数同步归零
    injected = 0;
    energy = 0;
  };

  /** fluidP 归零时清场:倒放回起点后重进,脉冲从头可复现 */
  const resetFields = (gl: WebGL2RenderingContext): void => {
    if (injected === 0 && energy === 0) return;
    injected = 0;
    energy = 0;
    lastTimeMs = 0;
    gl.clearColor(0, 0, 0, 0);
    const targets: FluidTarget[] = [];
    for (const pp of [velocity, dye, pressure]) {
      if (pp) targets.push(pp.read, pp.write);
    }
    if (divergence) targets.push(divergence);
    for (const t of targets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  /** 向目标 FBO 全屏绘制(模拟分辨率视口) */
  const blit = (gl: WebGL2RenderingContext, target: FluidTarget): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, allocW, allocH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /** 平流:src 场沿 velocity.read 回溯,写入 src.write 后互换 */
  const advect = (
    gl: WebGL2RenderingContext,
    src: PingPong,
    dissipation: number,
    dt: number
  ): void => {
    if (!programs || !velocity) return;
    const { prog, loc } = programs.advect;
    applyProgram(gl, prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.read.tex);
    gl.uniform1i(loc.uVelocity ?? null, 0);
    gl.uniform1i(loc.uSource ?? null, 1);
    gl.uniform2f(loc.uTexel ?? null, 1 / allocW, 1 / allocH);
    gl.uniform1f(loc.uDt ?? null, dt);
    gl.uniform1f(loc.uDissipation ?? null, dissipation);
    blit(gl, src.write);
    swap(src);
  };

  /** 注入一轮 8 向脉冲到目标场(mode 0 速度 / 1 墨) */
  const splat = (
    gl: WebGL2RenderingContext,
    target: PingPong,
    mode: 0 | 1,
    pulse: PulseDef
  ): void => {
    if (!programs) return;
    const { prog, loc } = programs.splat;
    applyProgram(gl, prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.read.tex);
    gl.uniform1i(loc.uTarget ?? null, 0);
    gl.uniform2f(loc.uTexel ?? null, 1 / allocW, 1 / allocH);
    gl.uniform1f(loc.uMode ?? null, mode);
    gl.uniform1f(loc.uAngle0 ?? null, pulse.angle0);
    gl.uniform1f(
      loc.uStrength ?? null,
      mode === 0 ? pulse.strength : pulse.dye
    );
    gl.uniform1f(loc.uRadius ?? null, pulse.radius);
    blit(gl, target.write);
    swap(target);
  };

  /** 一帧完整模拟步:平流 -> 脉冲 -> 投影 -> 墨平流 */
  const step = (
    gl: WebGL2RenderingContext,
    fluidP: number,
    dt: number,
    tier: number
  ): void => {
    if (!programs || !velocity || !dye || !pressure || !divergence) return;
    gl.disable(gl.BLEND);
    advect(gl, velocity, VELOCITY_DISSIPATION, dt);
    // 检查点脉冲:上穿注入(注入与否由计数决定),下穿回收计数
    while (injected < PULSES.length) {
      const pulse = PULSES[injected];
      if (!pulse || fluidP < pulse.at) break;
      splat(gl, velocity, 0, pulse);
      splat(gl, dye, 1, pulse);
      injected += 1;
      energy = 1;
    }
    while (injected > 0) {
      const prev = PULSES[injected - 1];
      if (!prev || fluidP >= prev.at) break;
      injected -= 1;
    }
    const texelX = 1 / allocW;
    const texelY = 1 / allocH;
    // 散度
    const dvg = programs.divergence;
    applyProgram(gl, dvg.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
    gl.uniform1i(dvg.loc.uVelocity ?? null, 0);
    gl.uniform2f(dvg.loc.uTexel ?? null, texelX, texelY);
    blit(gl, divergence);
    // 压力 Jacobi:满档 14 次,降档 8 次(热启动,不清上一轮压力)
    const iterations = tier >= 2 ? 14 : 8;
    const prs = programs.pressure;
    applyProgram(gl, prs.prog);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, divergence.tex);
    gl.uniform1i(prs.loc.uDivergence ?? null, 1);
    gl.uniform2f(prs.loc.uTexel ?? null, texelX, texelY);
    for (let i = 0; i < iterations; i++) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pressure.read.tex);
      gl.uniform1i(prs.loc.uPressure ?? null, 0);
      blit(gl, pressure.write);
      swap(pressure);
    }
    // 减梯度
    const grd = programs.gradient;
    applyProgram(gl, grd.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pressure.read.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
    gl.uniform1i(grd.loc.uPressure ?? null, 0);
    gl.uniform1i(grd.loc.uVelocity ?? null, 1);
    gl.uniform2f(grd.loc.uTexel ?? null, texelX, texelY);
    blit(gl, velocity.write);
    swap(velocity);
    // 墨平流(耗散 0.985);能量同步衰减,静息后 isLive 停帧
    advect(gl, dye, DYE_DISSIPATION, dt);
    energy *= DYE_DISSIPATION;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  return {
    key: "fluid",
    enabled: true,
    isLive() {
      return lastVisible && simReady && energy > ENERGY_REST;
    },
    init(gl) {
      programs = {
        advect: buildProgram(gl, ADVECT_FS, [
          "uVelocity",
          "uSource",
          "uTexel",
          "uDt",
          "uDissipation",
        ]),
        splat: buildProgram(gl, SPLAT_FS, [
          "uTarget",
          "uTexel",
          "uMode",
          "uAngle0",
          "uStrength",
          "uRadius",
        ]),
        divergence: buildProgram(gl, DIVERGENCE_FS, ["uVelocity", "uTexel"]),
        pressure: buildProgram(gl, PRESSURE_FS, [
          "uPressure",
          "uDivergence",
          "uTexel",
        ]),
        gradient: buildProgram(gl, GRADIENT_FS, [
          "uPressure",
          "uVelocity",
          "uTexel",
        ]),
        composite: buildProgram(gl, COMPOSITE_FS, ["uDye", "uSize", "uP"]),
      };
      // 扩展按上下文启用:工厂探测过,真实上下文仍须显式 getExtension
      simReady = gl.getExtension("EXT_color_buffer_float") !== null;
      dummyDye = createTexture(gl, new ImageData(1, 1));
      // 上下文恢复重建:旧目标句柄已随丢失失效,只重置引用不删除
      velocity = null;
      dye = null;
      pressure = null;
      divergence = null;
      allocW = 0;
      allocH = 0;
      injected = 0;
      energy = 0;
      lastTimeMs = 0;
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!programs) return;
      lastVisible = (progress.get("fluidVisible") ?? 0) >= 0.5;
      if (!lastVisible) return;
      const fluidP = progress.get("fluidP") ?? 0;
      if (fluidP <= 0) {
        // 覆盖进度归零:清场并回收计数,重进从静水开始;
        // 不绘合成(p=0 时遮罩在中心仍有软点,跳绘避免其提前露出)
        resetFields(gl);
        return;
      }
      // dt 取真实帧距并钳制:休眠恢复后的大间隔不致模拟爆步
      const dtMs =
        lastTimeMs > 0
          ? Math.min(Math.max(ctx.timeMs - lastTimeMs, 0), 33)
          : 16;
      lastTimeMs = ctx.timeMs;
      if (simReady) {
        ensureTargets(gl, ctx.width, ctx.height, ctx.tier);
      }
      if (simReady && velocity && dye && pressure && divergence) {
        step(gl, fluidP, dtMs / 1000, ctx.tier);
      }
      // 合成到画布:遮罩兜底保证布局,墨只做涡卷边缘
      const cmp = programs.composite;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      applyProgram(gl, cmp.prog);
      gl.activeTexture(gl.TEXTURE0);
      const dyeTex = dye?.read.tex ?? dummyDye;
      gl.bindTexture(gl.TEXTURE_2D, dyeTex);
      gl.uniform1i(cmp.loc.uDye ?? null, 0);
      gl.uniform2f(cmp.loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(cmp.loc.uP ?? null, fluidP);
      gl.enable(gl.BLEND);
      // 透明预乘画布:alpha 通道必须直通(见计划勘误一)
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (programs) {
        for (const info of Object.values(programs)) {
          gl.deleteProgram(info.prog);
        }
      }
      releaseTargets(gl);
      if (dummyDye) gl.deleteTexture(dummyDye);
      programs = null;
      dummyDye = null;
      simReady = false;
    },
  };
}
