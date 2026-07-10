/**
 * 2.5D 深度推轨 pass:深度图分层视差 dolly + 径向光痕 + 末端压暗。
 * 穿越转场期间画布即全世界——全屏绘制,alpha 恒 1 不混合
 * (透明预乘勘误不适用,见计划勘误一)。uZoom 由转场喂 1-18,
 * 近处(深度亮)放大更快产生层间推轨;uSmear 中段最强拉出径向拖影;
 * uDark 末端压暗到墨色,与宣言章底色 #0e0e0d 咬合。
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
}`;

/**
 * 创建 2.5D 推轨 pass。
 * 读 progress 键:dollyZoom(1-18 推入倍率)/dollySmear(0-1 径向拖影强度)/
 * dollyDark(0-1 末端压暗)/dollyVisible(< 0.5 跳绘,缺省不可见——
 * 全屏 alpha 1 输出,默认可见会盖死整页)。
 * image 为主样张,depth 为同构图灰度深度图(亮近暗远)。
 */
export function createDollyPass(
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
    "uZoom",
    "uSmear",
    "uDark",
  ] as const;
  return {
    key: "dolly",
    enabled: true,
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
      // 可见门:仅穿越转场窗口内绘制(缺省 0,防止全屏覆写)
      if ((progress.get("dollyVisible") ?? 0) < 0.5) return;
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, imageTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.uniform1i(loc.uImage ?? null, 0);
      gl.uniform1i(loc.uDepth ?? null, 1);
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      // uZoom 缺省 1(无推入);除数恒 >= 1,无除零风险
      gl.uniform1f(loc.uZoom ?? null, progress.get("dollyZoom") ?? 1);
      gl.uniform1f(loc.uSmear ?? null, progress.get("dollySmear") ?? 0);
      gl.uniform1f(loc.uDark ?? null, progress.get("dollyDark") ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 纹理单元复位,避免污染后续 pass 的 TEXTURE0 绑定
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
