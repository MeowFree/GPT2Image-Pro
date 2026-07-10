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
