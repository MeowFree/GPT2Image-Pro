/**
 * 扩散显影 pass:结构噪声主导 + 按目标亮度偏置的逐像素显影。
 * 每个像素有自己的显影时刻,且深色(墨)像素先显影——大结构先出、
 * 细节后出,视觉上是"这一笔正在被画出来",区别于整图交叉淡化。
 * v0.9 生长升级:显影前锋经域扭曲呈指状分形生长(扩散模型的物质隐喻,
 * 全部保持进度纯函数、倒放成立);已显影区域"由湿到干"——湿阶段
 * 软采样微洇加深,随显影完成收敛锐利。
 * 未显影区域是纸灰底上漂移的絮状墨云(材质世界观:纸/墨,非数字网点);
 * IGN 只保留微小权重做收敛抖动。矩形由 dom-sync 喂入,GL 在 DOM 原位绘制。
 * uCrop 取景窗供 macro 凝视幕:推近笔触局部,边缘随取景收窄入焦外(DOF)。
 * keys 参数使多实例共存(画布显影与标题显影读不同 progress 键)。
 * 三种模式(v1.0):field 为噪场底显影(默认,画布主角);text 供文字
 * 纹理——未显影区输出透明,显影偏置按纹理 alpha(笔画实体先显影);
 * overlay 供 revise 定稿覆盖初稿——未显影区输出透明,偏置按亮度,
 * 配 centerBias 径向偏置(离朱笔圈心越远越晚显影,修改从圈选处生长)。
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
uniform float uMode;
uniform vec3 uCrop;
uniform vec3 uCenterBias;
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
  // 微距取景窗:crop 中心 + 缩放(缺省 0.5/0.5/1 即全幅原样)
  vec2 sampleUv = uCrop.xy + (local - 0.5) * uCrop.z;
  vec4 texel = texture(uImage, sampleUv);
  float texLum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
  // 由湿到干:显影中软采样微洇(墨未干),完成后收敛锐利;
  // 微距时边缘随距取景中心变糊(浅景深,凝视中心锐利)
  float dry = smoothstep(0.55, 1.0, uP);
  float soft = (1.0 - dry) * 0.0045
    + length(local - 0.5) * (1.0 - uCrop.z) * 0.007;
  vec3 blurred = (texel.rgb
    + texture(uImage, sampleUv + vec2(soft, soft * 0.6)).rgb
    + texture(uImage, sampleUv + vec2(-soft, soft)).rgb
    + texture(uImage, sampleUv + vec2(soft * 0.5, -soft)).rgb
    + texture(uImage, sampleUv + vec2(-soft * 0.7, -soft * 0.5)).rgb
  ) * 0.2;
  vec3 imgCol = mix(texel.rgb, blurred, clamp(soft * 400.0, 0.0, 1.0));
  // 阈值构成:大结构(同区域同批显影)>细颗粒(边缘破碎)>IGN 微抖(收敛),
  // 结构噪声经域扭曲——显影前锋呈指状分形生长而非软圆边;
  // 再按目标减去亮度偏置——深色的墨先落纸,大结构先出、细节后出
  vec2 warp = vec2(fbm(local * 3.0 + 7.3), fbm(local * 3.0 - 2.1));
  float structure = fbm(local * 5.0 + (warp - 0.5) * 0.9);
  float grain = fbm(local * 23.0);
  float dither = ign(gl_FragCoord.xy);
  float bias = uMode > 0.5 && uMode < 1.5
    ? texel.a * 0.3
    : (1.0 - texLum) * 0.35;
  // 径向偏置:离圈心越远显影阈值越高(修改从朱笔圈选处向外生长);
  // 强度 0 时无效果,不影响其他实例
  float radial = length(local - uCenterBias.xy) * uCenterBias.z;
  float threshold =
    structure * 0.52 + grain * 0.3 + dither * 0.18 - bias + radial;
  float reveal = smoothstep(
    threshold - 0.06, threshold + 0.06, uP * 1.7 - 0.5);
  if (uMode > 1.5) {
    // overlay:未显影区透明,已显影为图像本体(叠于底层初稿之上,
    // 定稿沿生长前锋逐步覆盖)
    outColor = vec4(imgCol, reveal);
    return;
  }
  if (uMode > 0.5) {
    // 文字纹理为深色字+透明底:未显影区域输出透明("墨渗入纸"),
    // 噪场底色对文字不适用
    outColor = vec4(texel.rgb, reveal * texel.a);
    return;
  }
  // 未显影区:纸灰底上漂移的絮状墨云(潜像),非中性灰数字噪点
  vec2 drift = vec2(uTime * 0.00012, uTime * 0.00007);
  float cloud = fbm(local * 8.0 + drift);
  float fleck = fbm(local * 26.0 - drift * 0.7);
  float flake = smoothstep(0.6, 0.95, cloud * 0.55 + fleck * 0.45);
  vec3 paperCol = vec3(0.955, 0.945, 0.915) * (0.97 + fleck * 0.05);
  vec3 noiseCol = mix(paperCol, vec3(0.35, 0.33, 0.31), flake * 0.5);
  vec3 col = mix(noiseCol, imgCol, reveal);
  // 显影带瞬时加深:墨落纸未干时更深(湿边暗环),随显影完成回到成品色
  float band = reveal * (1.0 - reveal) * 4.0;
  col *= 1.0 - band * 0.16 * (1.0 - texLum);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += uGlow * smoothstep(0.75, 1.0, lum) * 0.25;
  outColor = vec4(col, 1.0);
}`;

/** 多实例显影 pass 的 progress 读键配置;crop 可选(仅画布实例用微距) */
export interface DenoiseKeys {
  rect: string;
  p: string;
  glow: string;
  visible: string;
  crop?: string;
}

const DEFAULT_KEYS: DenoiseKeys = {
  rect: "canvasRect",
  p: "denoiseP",
  glow: "denoiseGlow",
  visible: "denoiseVisible",
  crop: "canvasCrop",
};

/** 显影模式:field 噪场底 / text 文字透明底 / overlay 定稿覆盖初稿 */
export type DenoiseMode = "field" | "text" | "overlay";

export interface DenoiseOptions {
  mode?: DenoiseMode;
  /** 圈心生长偏置 [圈心x, 圈心y, 强度];缺省强度 0(关闭) */
  centerBias?: readonly [number, number, number];
}

/**
 * 创建去噪显影 pass。
 * 读 progress 键(默认):denoiseP(显影进度)/canvasRect.x|y|w|h(矩形视口
 * 分数)/denoiseGlow(白部辉光)/denoiseVisible(< 0.5 跳绘,缺省视为可见)。
 * keys 覆写读键即可多实例共存(标题显影读 titleRect/titleP/...);
 * pass key 取 rect+p 键名以区分实例(revise 与画布实例共用 rect)。
 * options.mode 见 DenoiseMode;text/overlay 输出透明底,按 alpha 混合。
 */
export function createDenoisePass(
  image: TexImageSource,
  keys: DenoiseKeys = DEFAULT_KEYS,
  options: DenoiseOptions = {}
): CinemaPass {
  const mode: DenoiseMode = options.mode ?? "field";
  const modeValue = mode === "field" ? 0 : mode === "text" ? 1 : 2;
  const centerBias = options.centerBias ?? ([0.5, 0.5, 0] as const);
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
    "uMode",
    "uCrop",
    "uCenterBias",
  ] as const;
  return {
    key: `denoise:${keys.rect}:${keys.p}`,
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
      if (mode !== "field") {
        // text/overlay 输出透明底,必须混合叠加以免整块覆写其他 pass;
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
      gl.uniform1f(loc.uMode ?? null, modeValue);
      gl.uniform3f(
        loc.uCenterBias ?? null,
        centerBias[0],
        centerBias[1],
        centerBias[2]
      );
      // 微距取景窗:未配置或未喂键时为全幅原样(0.5/0.5/1)
      gl.uniform3f(
        loc.uCrop ?? null,
        (keys.crop ? progress.get(`${keys.crop}.x`) : undefined) ?? 0.5,
        (keys.crop ? progress.get(`${keys.crop}.y`) : undefined) ?? 0.5,
        (keys.crop ? progress.get(`${keys.crop}.z`) : undefined) ?? 1
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (mode !== "field") gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      if (tex) gl.deleteTexture(tex);
      prog = null;
      tex = null;
    },
  };
}
