/**
 * 墨水流体 pass:四分之一分辨率 stable-fluids 墨模拟,同一实例双用途。
 * 用途一(dive 反转转场):进度覆盖遮罩为布局真相(fluidP=1 必然全覆盖,
 * 滚动倒放时遮罩精确可逆),流体 dye 只负责边缘的涡卷质感;
 * 用途二(序幕活墨,v0.9):墨滴落纸后一团淡墨真实洇开舒展,prompt 打字
 * 时被向心力聚拢成涡——开场那滴墨就是后来那幅画的原料(因果链)。
 * 两用途读键互斥(fluidVisible 优先),模式切换必清场;检查点脉冲全由
 * 常量表定义(半确定性,倒放重进可复现)。
 * 需要 EXT_color_buffer_float(RGBA16F 可渲染);不可用时工厂返回 null,
 * 反转由 dolly 末端压暗与宣言章 DOM 底色兜底,活墨直接缺席(纯质感层)。
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

/** 检查点脉冲注入:uCenter 向外 8 向高斯 splat,一次绘制注满一轮脉冲;
 * uSpread 为 8 向散布半径(dive 0.06 宽散,活墨 0.03 集中成团) */
const SPLAT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTarget;
uniform vec2 uTexel;
uniform float uMode;
uniform vec2 uCenter;
uniform float uAngle0;
uniform float uStrength;
uniform float uRadius;
uniform float uSpread;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec3 acc = texture(uTarget, uv).xyz;
  for (int k = 0; k < 8; k++) {
    float ang = uAngle0 + float(k) * 0.785398;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 d = uv - (uCenter + dir * uSpread);
    float g = exp(-dot(d, d) / uRadius);
    acc += uMode < 0.5
      ? vec3(dir * uStrength * g, 0.0)
      : vec3(uStrength * g, 0.0, 0.0);
  }
  outColor = vec4(acc, 1.0);
}`;

/**
 * 向心汇聚:全场速度加指向 uTarget 的分量(活墨被 prompt"召唤"聚拢)。
 * 近中心衰减防爆速;投影步会抵消部分散度,墨在中心转成涡——
 * 聚墨成涡正是水墨行为。
 */
const GATHER_FS = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
uniform vec2 uTarget;
uniform float uAmount;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 vel = texture(uVelocity, uv).xy;
  vec2 to = uTarget - uv;
  float d = max(length(to), 1e-4);
  vel += (to / d) * uAmount * smoothstep(0.02, 0.3, d);
  outColor = vec4(vel, 0.0, 1.0);
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
 * 合成,双模式。
 * uMode 0(dive 覆盖):coverage = max(墨浓度, 径向遮罩)。遮罩是布局真相
 * (fluidP=1 时角点距离 0.707 < 0.85-0.05,必然全覆盖);墨色与宣言章
 * 底色一致(#0e0e0d)。
 * uMode 1(序幕活墨):dye 显作淡墨洇纸——浓处深、边缘透(幂压边缘),
 * 无遮罩,纯质感层;uFade 由编排层喂(显影开始后墨被画布"吸走")。
 */
const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uDye;
uniform vec2 uSize;
uniform float uP;
uniform float uMode;
uniform float uFade;
out vec4 outColor;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float dye = texture(uDye, uv).x;
  if (uMode > 0.5) {
    // 活墨浓淡两层:浓芯(高幂,深)沉在中心,淡晕(低幂,浅)洇向四周
    // ——墨不是均匀灰饼;淡晕带吸收阈值(极稀残墨被纸吸收隐形,
    // 否则被低幂放大成全屏皱纹,走查实证);纸吸墨不均由微扰表达
    float d = clamp(dye, 0.0, 1.0);
    float core = pow(d, 2.4) * 0.32;
    float halo = pow(max(d - 0.05, 0.0) / 0.95, 0.85) * 0.13;
    float grainy = 0.95 + hash(gl_FragCoord.xy * 0.5) * 0.1;
    outColor = vec4(0.13, 0.12, 0.105, (core + halo) * grainy * uFade);
    return;
  }
  float r = uP * 0.85;
  float mask = smoothstep(r + 0.12, r - 0.05, distance(uv, vec2(0.5)));
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

/** dive 覆盖脉冲的注入中心(视口中央) */
const DIVE_CENTER: readonly [number, number] = [0.5, 0.5];

/**
 * 序幕活墨脉冲:落点在墨滴迸溅点略下方(墨落纸),强度远低于 dive
 * ——要"洇"不要"涌"(强速度场几秒内会把墨吹满全屏成均匀噪雾,
 * 走查实证,故近乎纯扩散);冲击只给起始一拍,浓度由持续渗出维持。
 */
const INK_PULSES: readonly PulseDef[] = [
  { at: 0.04, angle0: 0.4, strength: 0.08, dye: 0.6, radius: 0.0028 },
  { at: 0.16, angle0: 1.1, strength: 0.06, dye: 0.35, radius: 0.004 },
  { at: 0.38, angle0: 2.0, strength: 0.05, dye: 0.25, radius: 0.0055 },
];

/**
 * 活墨脉冲的注入中心。坐标为模拟场系(GL 系,y 向上):
 * y=0.7 即屏幕顶部 30% 处——与墨滴迸溅点(视口分数 0.24)咬合,
 * 墨云挂在标题上缘,聚拢段被拉向画布中心。
 */
const INK_CENTER: readonly [number, number] = [0.5, 0.7];

/** 活墨聚拢目标:画布主角中心(与 centerSquareRect 构图对应) */
const GATHER_TARGET: readonly [number, number] = [0.5, 0.5];

/** 8 向 splat 散布半径:dive 宽散吞屏,活墨集中成团 */
const DIVE_SPREAD = 0.06;
const INK_SPREAD = 0.018;

/**
 * 活墨渗出速率:活墨模式存续期间每帧按 dt 补墨——浓度是注入率与
 * 耗散率的动态平衡,与滚动速度无关(快滚/停留/截屏任意时刻可见);
 * 砚台里的墨,一直在;生命周期完全交给 inkFade(淡出即散)。
 */
const INK_SEEP_DYE_RATE = 1.2;
const INK_SEEP_VEL_RATE = 0.35;

/** 活墨专用耗散:速度快静息(墨靠扩散慢展),墨迹长驻留 */
const INK_VELOCITY_DISSIPATION = 0.985;
const INK_DYE_DISSIPATION = 0.9975;

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
  gather: ProgramInfo;
  divergence: ProgramInfo;
  pressure: ProgramInfo;
  gradient: ProgramInfo;
  composite: ProgramInfo;
}

/** 双用途模式:0 未激活 / 1 dive 覆盖 / 2 序幕活墨 */
type FluidMode = 0 | 1 | 2;

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
 * 读 progress 键——用途一(dive):fluidP(0-1 反转覆盖进度)/
 * fluidVisible(>= 0.5 激活,优先);用途二(序幕活墨):inkP(0-1 活墨
 * 生命进度,驱动脉冲注入与清场)/inkGather(0-1 向心聚拢强度)/
 * inkFade(0-1 显示强度,> 0.001 激活)。模式切换必清场(共享模拟场,
 * 残留跨用途无意义)。
 * 每帧序列:advect(velocity) -> 检查点 splat -> [活墨向心 gather] ->
 * divergence -> pressure Jacobi(满档 14 次,降档 8 次) ->
 * subtractGradient -> advect(dye, 耗散 0.985) -> 全屏合成(alpha 混合,
 * 预乘勘误直通)。分辨率:满档 1/4,降档 1/6。
 * isLive 在激活且(能量未耗尽或聚拢中)为 true。
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
  /** 当前激活模式(dive 优先);切换时清场 */
  let activeMode: FluidMode = 0;
  /** 最近一帧的聚拢强度:聚拢中场持续演化,isLive 须保持出帧 */
  let lastGather = 0;

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

  /** 注入一轮 8 向脉冲到目标场(mode 0 速度 / 1 墨),center 为注入中心 */
  const splat = (
    gl: WebGL2RenderingContext,
    target: PingPong,
    mode: 0 | 1,
    pulse: PulseDef,
    center: readonly [number, number],
    spread: number
  ): void => {
    if (!programs) return;
    const { prog, loc } = programs.splat;
    applyProgram(gl, prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.read.tex);
    gl.uniform1i(loc.uTarget ?? null, 0);
    gl.uniform2f(loc.uTexel ?? null, 1 / allocW, 1 / allocH);
    gl.uniform1f(loc.uMode ?? null, mode);
    gl.uniform2f(loc.uCenter ?? null, center[0], center[1]);
    gl.uniform1f(loc.uAngle0 ?? null, pulse.angle0);
    gl.uniform1f(
      loc.uStrength ?? null,
      mode === 0 ? pulse.strength : pulse.dye
    );
    gl.uniform1f(loc.uRadius ?? null, pulse.radius);
    gl.uniform1f(loc.uSpread ?? null, spread);
    blit(gl, target.write);
    swap(target);
  };

  /** 向心汇聚:活墨被 prompt 召唤,全场速度加指向画布中心的分量 */
  const applyGather = (
    gl: WebGL2RenderingContext,
    amount: number,
    dt: number
  ): void => {
    if (!programs || !velocity) return;
    const { prog, loc } = programs.gather;
    applyProgram(gl, prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, velocity.read.tex);
    gl.uniform1i(loc.uVelocity ?? null, 0);
    gl.uniform2f(loc.uTexel ?? null, 1 / allocW, 1 / allocH);
    gl.uniform2f(loc.uTarget ?? null, GATHER_TARGET[0], GATHER_TARGET[1]);
    // 幅度克制:向心流太强会把墨吸穿中心散尽(不可压缩场,墨会穿过去,
    // 静帧上呈"月牙缺口",走查实证)
    gl.uniform1f(loc.uAmount ?? null, amount * dt * 0.55);
    blit(gl, velocity.write);
    swap(velocity);
  };

  /** 一帧完整模拟步:平流 -> 脉冲 -> [活墨向心] -> 投影 -> 墨平流 */
  const step = (
    gl: WebGL2RenderingContext,
    p: number,
    dt: number,
    tier: number,
    mode: FluidMode,
    gather: number
  ): void => {
    if (!programs || !velocity || !dye || !pressure || !divergence) return;
    gl.disable(gl.BLEND);
    advect(
      gl,
      velocity,
      mode === 2 ? INK_VELOCITY_DISSIPATION : VELOCITY_DISSIPATION,
      dt
    );
    // 检查点脉冲:上穿注入(注入与否由计数决定),下穿回收计数;
    // 脉冲表与注入中心按模式取用(模式切换必经清场,计数可复用)
    const pulses = mode === 2 ? INK_PULSES : PULSES;
    const center = mode === 2 ? INK_CENTER : DIVE_CENTER;
    const spread = mode === 2 ? INK_SPREAD : DIVE_SPREAD;
    while (injected < pulses.length) {
      const pulse = pulses[injected];
      if (!pulse || p < pulse.at) break;
      splat(gl, velocity, 0, pulse, center, spread);
      splat(gl, dye, 1, pulse, center, spread);
      injected += 1;
      energy = 1;
    }
    while (injected > 0) {
      const prev = pulses[injected - 1];
      if (!prev || p >= prev.at) break;
      injected -= 1;
    }
    // 活墨持续渗出:浓度为注入率与耗散率的动态平衡——快滚过脉冲点
    // 或长停留后墨云依旧在场(一次性脉冲会在数秒内耗散殆尽,走查实证);
    // 存续期间恒渗,聚拢段的向心流因此成为可见的"墨被吸入"动线
    if (mode === 2 && p > 0.04) {
      const seep: PulseDef = {
        at: 0,
        angle0: p * 6.28 + 0.9,
        strength: INK_SEEP_VEL_RATE * dt,
        dye: INK_SEEP_DYE_RATE * dt,
        radius: 0.0035,
      };
      splat(gl, velocity, 0, seep, INK_CENTER, INK_SPREAD);
      splat(gl, dye, 1, seep, INK_CENTER, INK_SPREAD);
      energy = Math.max(energy, 0.3);
    }
    // 活墨聚拢:向心力持续注入,场保持演化(能量下限同步保持)
    if (mode === 2 && gather > 0.001) {
      applyGather(gl, gather, dt);
      energy = Math.max(energy, gather * 0.4);
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
    // 墨平流(活墨长驻留/dive 快消散);能量同步衰减,静息后 isLive 停帧
    const dyeDissipation =
      mode === 2 ? INK_DYE_DISSIPATION : DYE_DISSIPATION;
    advect(gl, dye, dyeDissipation, dt);
    energy *= dyeDissipation;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  return {
    key: "fluid",
    enabled: true,
    isLive() {
      return (
        activeMode !== 0 &&
        simReady &&
        (energy > ENERGY_REST || lastGather > 0.01)
      );
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
          "uCenter",
          "uAngle0",
          "uStrength",
          "uRadius",
          "uSpread",
        ]),
        gather: buildProgram(gl, GATHER_FS, [
          "uVelocity",
          "uTexel",
          "uTarget",
          "uAmount",
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
        composite: buildProgram(gl, COMPOSITE_FS, [
          "uDye",
          "uSize",
          "uP",
          "uMode",
          "uFade",
        ]),
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
      activeMode = 0;
      lastGather = 0;
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!programs) return;
      // 模式仲裁:dive 覆盖优先(转场是布局真相),否则活墨,否则不激活
      const diveOn = (progress.get("fluidVisible") ?? 0) >= 0.5;
      const inkFade = progress.get("inkFade") ?? 0;
      const mode: FluidMode = diveOn ? 1 : inkFade > 0.001 ? 2 : 0;
      if (mode !== activeMode) {
        // 模式切换必清场:两用途共享模拟场,残留跨用途无意义
        // (含大跨度跳滚直接落进另一用途窗口的情形)
        resetFields(gl);
        activeMode = mode;
      }
      if (mode === 0) {
        lastGather = 0;
        return;
      }
      const p =
        mode === 1
          ? (progress.get("fluidP") ?? 0)
          : (progress.get("inkP") ?? 0);
      if (p <= 0.001) {
        // 进度归零:清场并回收计数,重进从静水开始;
        // 不绘合成(dive 遮罩在 p=0 时中心仍有软点,跳绘避免其提前露出)
        resetFields(gl);
        return;
      }
      lastGather = mode === 2 ? (progress.get("inkGather") ?? 0) : 0;
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
        step(gl, p, dtMs / 1000, ctx.tier, mode, lastGather);
      }
      // 合成到画布:dive 遮罩兜底保证布局,活墨为纯质感层
      const cmp = programs.composite;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, ctx.width, ctx.height);
      applyProgram(gl, cmp.prog);
      gl.activeTexture(gl.TEXTURE0);
      const dyeTex = dye?.read.tex ?? dummyDye;
      gl.bindTexture(gl.TEXTURE_2D, dyeTex);
      gl.uniform1i(cmp.loc.uDye ?? null, 0);
      gl.uniform2f(cmp.loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(cmp.loc.uP ?? null, p);
      gl.uniform1f(cmp.loc.uMode ?? null, mode === 2 ? 1 : 0);
      gl.uniform1f(cmp.loc.uFade ?? null, mode === 2 ? inkFade : 1);
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
