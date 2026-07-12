/**
 * 2.5D 深度推轨 pass:深度图分层视差 dolly + 体积光 + 末端压暗。
 * 穿越转场期间画布即全世界——全屏绘制,alpha 恒 1 不混合
 * (透明预乘勘误不适用,见计划勘误一)。uZoom 由转场喂 1-18,
 * 近处(深度亮)放大更快产生层间推轨;uSmear 中段最强拉出径向拖影。
 * v0.9 体积光:cover 采样(方形图短边贴合视口,不再被长宽比拉伸,
 * 与 macro 幕放大后的画布几何咬合)、光轴亮痕(god rays 收束感)、
 * 径向纸纤维细丝在高 zoom 段掠过(扎进纸的纤维之间)、穿透纸芯的
 * 暖光一瞬(纸的内部是光);uDark 末端压暗到墨色,与宣言章底色
 * #0e0e0d 咬合。全部量为进度纯函数,倒放成立。
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
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  uv.y = 1.0 - uv.y;
  vec2 c = vec2(0.5);
  // cover 采样:方向量按视口像素换算再除长边——方形图短边贴合视口,
  // 不被长宽比拉伸;0.9804 = 1/1.02,与 macro 幕画布放大终值(视口
  // 长边 x1.02 的方形)逐像素咬合,交棒帧内容零跳变
  vec2 dir = (uv - c) * uSize / max(uSize.x, uSize.y) * 0.9804;
  float depth = texture(uDepth, c + dir / uZoom).r;
  // 深度视差:近处(depth 大)放大更快,产生层间推轨
  vec2 zuv = c + dir / (uZoom * (1.0 + (depth - 0.5) * 0.35));
  vec3 acc = vec3(0.0);
  // 径向拖影:向中心 8 次采样,近心 tap 加权(光向中心收束)
  float wsum = 0.0;
  for (int k = 0; k < 8; k++) {
    float f = float(k) / 8.0 * uSmear * 0.35;
    float w = 1.0 + float(k) * 0.18 * uSmear;
    acc += texture(uImage, mix(zuv, c, f)).rgb * w;
    wsum += w;
  }
  vec3 col = acc / wsum;
  // god rays:视线中心的光轴亮痕,随拖影峰值起落(暖白,非纯白;
  // 只在墨迹尚在视野的低 zoom 段有对比,白纸段自然无感)
  float axis = pow(max(0.0, 1.0 - length(dir) * 1.7), 3.0);
  col += axis * uSmear * 0.28 * vec3(1.0, 0.985, 0.94);
  // 纸纤维隧道:径向拉伸的细丝掠过——扎进纸的纤维之间。
  // 白纸段体积光必须用"影"呈现(白底加白不可见,走查实证):
  // 纤维为暗纹,叠加边缘隧道压暗,穿行感来自流动的阴影
  float ang = atan(dir.y, dir.x);
  float r = length(dir);
  float fiber = vnoise(vec2(ang * 14.0, r * 3.0 - uZoom * 1.35))
    * 0.6 + vnoise(vec2(ang * 31.0, r * 5.0 - uZoom * 2.2)) * 0.4;
  float fiberAmt = smoothstep(2.0, 7.0, uZoom) * (1.0 - uDark);
  col *= 1.0 - smoothstep(0.62, 0.92, fiber) * fiberAmt * 0.16;
  // 隧道边缘压暗:视野四周向纸内收拢,中心留光
  float tunnel = smoothstep(0.3, 0.72, r) * fiberAmt;
  col *= 1.0 - tunnel * 0.14;
  // 穿透纸芯的暖光一瞬:zoom 中后段色温微暖(纸的内部是光),
  // 入暗前回落——暖光与压暗不同时在场
  float warmth = smoothstep(4.0, 8.0, uZoom)
    * (1.0 - smoothstep(12.0, 17.0, uZoom));
  col *= mix(vec3(1.0), vec3(1.06, 1.022, 0.95), warmth);
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
