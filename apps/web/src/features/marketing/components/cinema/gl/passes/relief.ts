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
import { HEIGHT_NORMAL, PAPER_GLOW } from "../ink/chunks";

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
  // hero 深度图为 1024x1024;Sobel 步长随取景窗缩放(亚 texel 时靠 LINEAR 插值保持梯度连续)
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
