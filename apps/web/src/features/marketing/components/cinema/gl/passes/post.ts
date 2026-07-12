/**
 * 胶片后处理:双层颗粒 + 边缘晕影 + 纸面掠光 + 装裱闪光,
 * 半透明罩合成于整页之上(净效应为正时提亮、为负时压暗)。
 * WHY IGN:interleaved gradient noise 免纹理资产,视觉近蓝噪声,
 * 逐帧偏移防静态纹样;纸簇层为静态 fbm(纸是静的,纤维不随时间)。
 * v0.9 掠光:纸纹高度场数值梯度 x 随 master 缓转的光向——滚动时
 * 光在纸面上流动,纸从"底色"变成"受光的物质";强度极低(<=0.05)
 * 保持编辑部克制。uFlash(postFlash 键)供装裱时刻的白闪一拍。
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
uniform float uMaster;
uniform float uFlash;
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
  vec2 uv = gl_FragCoord.xy / uSize;
  // 动颗粒:IGN 逐帧漂移(胶片粒);静纸簇:纤维簇不随时间(纸是静的)
  float g = ign(gl_FragCoord.xy + vec2(mod(uTime * 0.06, 64.0)));
  float clump = fbm(gl_FragCoord.xy / 42.0);
  // 纸面掠光:高度场数值梯度 x 缓转光向,随滚动光角变化——
  // 光在纸面上流动;梯度直接定标(不归一化,平坦处自然无光)
  float hC = fbm(gl_FragCoord.xy / 26.0);
  float hX = fbm((gl_FragCoord.xy + vec2(1.6, 0.0)) / 26.0);
  float hY = fbm((gl_FragCoord.xy + vec2(0.0, 1.6)) / 26.0);
  vec2 grad = vec2(hX - hC, hY - hC);
  float la = uMaster * 2.2 + 0.7;
  float sheen = clamp(dot(grad, vec2(cos(la), sin(la))) * 34.0, -1.0, 1.0);
  // 合成:晕影 + 颗粒 + 纸簇 + 掠光暗面为压暗量,掠光亮面 + 闪光为
  // 提亮量;净效应决定罩色(白/黑)与不透明度。
  // 纸簇与掠光强度压在感知阈值附近(走查实证:0.05 级会斑驳发脏)
  float v = smoothstep(0.55, 1.05, distance(uv, vec2(0.5)) * 1.2);
  float darkA = v * uVignette + (g - 0.5) * uGrain
    + (clump - 0.5) * 0.016 + max(-sheen, 0.0) * 0.02;
  float lightA = max(sheen, 0.0) * 0.016 + uFlash * 0.14;
  float net = lightA - clamp(darkA, 0.0, 1.0);
  vec3 col = net > 0.0 ? vec3(1.0, 0.99, 0.96) : vec3(0.0);
  outColor = vec4(col, clamp(abs(net), 0.0, 1.0));
}`;

export function createPostPass(): CinemaPass {
  let prog: WebGLProgram | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const names = [
    "uSize",
    "uTime",
    "uGrain",
    "uVignette",
    "uMaster",
    "uFlash",
  ] as const;
  return {
    key: "post",
    enabled: true,
    init(gl) {
      prog = compileProgram(gl, FULLSCREEN_VS, FS);
      for (const name of names) {
        loc[name] = gl.getUniformLocation(prog, name);
      }
    },
    render(ctx: PassContext) {
      const { gl } = ctx;
      if (!prog) return;
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      // WHY blendFuncSeparate:画布以预乘 alpha 与页面合成,若 alpha 通道也用
      // SRC_ALPHA 因子,写入透明底的结果是 a*a(颗粒 0.025 平方后不可见)。
      // alpha 通道用 ONE 累积直通 alpha,页面才按 (1-a) 正确变暗。
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(loc.uTime ?? null, ctx.timeMs);
      gl.uniform1f(loc.uGrain ?? null, ctx.progress.get("postGrain") ?? 0.05);
      gl.uniform1f(
        loc.uVignette ?? null,
        ctx.progress.get("postVignette") ?? 0.35
      );
      // master 由 CinemaStage 直喂,无需专用键;缺省 0(掠光角静止)
      gl.uniform1f(loc.uMaster ?? null, ctx.progress.get("master") ?? 0);
      gl.uniform1f(loc.uFlash ?? null, ctx.progress.get("postFlash") ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      prog = null;
    },
  };
}
