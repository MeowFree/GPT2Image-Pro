/**
 * 扩散显影 pass:IGN 阈值 + 低频噪场偏置的逐像素显影。
 * 每个像素有自己的显影时刻——"真实的去噪过程视觉",
 * 区别于整图交叉淡化。矩形由 dom-sync 喂入,GL 在 DOM 原位绘制。
 * keys 参数使多实例共存(画布显影与标题显影读不同 progress 键);
 * textMode 供文字纹理:未显影区域输出透明而非噪场,按 alpha 混合叠加。
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
uniform float uTextMode;
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
  vec4 texel = texture(uImage, local);
  if (uTextMode > 0.5) {
    // 文字纹理为深色字+透明底:未显影区域输出透明("墨渗入纸"),
    // 噪场底色对文字不适用
    outColor = vec4(texel.rgb, reveal * texel.a);
    return;
  }
  float n = fbm(local * 9.0 + vec2(uTime * 0.00012, uTime * 0.00007));
  vec3 noiseCol = vec3(0.72 + n * 0.2);
  vec3 col = mix(noiseCol, texel.rgb, reveal);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += uGlow * smoothstep(0.75, 1.0, lum) * 0.25;
  outColor = vec4(col, 1.0);
}`;

/** 多实例显影 pass 的 progress 读键配置 */
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

/**
 * 创建去噪显影 pass。
 * 读 progress 键(默认):denoiseP(显影进度)/canvasRect.x|y|w|h(矩形视口
 * 分数)/denoiseGlow(白部辉光)/denoiseVisible(< 0.5 跳绘,缺省视为可见)。
 * keys 覆写读键即可多实例共存(标题显影读 titleRect/titleP/...);
 * pass key 取 denoise:rect 键名以区分实例。
 * textMode:文字纹理模式,未显影区域输出透明并按 alpha 混合。
 */
export function createDenoisePass(
  image: TexImageSource,
  keys: DenoiseKeys = DEFAULT_KEYS,
  textMode = false
): CinemaPass {
  let prog: WebGLProgram | null = null;
  let tex: WebGLTexture | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const names = [
    "uSize",
    "uImage",
    "uRect",
    "uP",
    "uGlow",
    "uTime",
    "uTextMode",
  ] as const;
  return {
    key: `denoise:${keys.rect}`,
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
      // 可见门:所属场景不在场时跳绘(键缺省视为可见,兼容旧单实例用法)
      if ((progress.get(keys.visible) ?? 1) < 0.5) return;
      // 矩形宽度 <= 0 表示目标元素未就位,跳绘
      const w = progress.get(`${keys.rect}.w`) ?? 0;
      if (w <= 0) return;
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (textMode) {
        // 文字纹理带透明底,必须混合叠加以免整块覆写其他 pass;
        // 透明预乘画布 alpha 通道须直通(见计划勘误一)
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(
          gl.SRC_ALPHA,
          gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA
        );
      }
      gl.uniform1i(loc.uImage ?? null, 0);
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform4f(
        loc.uRect ?? null,
        progress.get(`${keys.rect}.x`) ?? 0,
        progress.get(`${keys.rect}.y`) ?? 0,
        w,
        progress.get(`${keys.rect}.h`) ?? 0
      );
      gl.uniform1f(loc.uP ?? null, progress.get(keys.p) ?? 0);
      gl.uniform1f(loc.uGlow ?? null, progress.get(keys.glow) ?? 0);
      gl.uniform1f(loc.uTime ?? null, ctx.timeMs);
      gl.uniform1f(loc.uTextMode ?? null, textMode ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (textMode) gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      if (tex) gl.deleteTexture(tex);
      prog = null;
      tex = null;
    },
  };
}
