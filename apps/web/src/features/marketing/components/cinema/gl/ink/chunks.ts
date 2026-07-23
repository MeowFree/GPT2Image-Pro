/**
 * 水墨 NPR 共享 GLSL 库(v1.2 自研渲染管线核心)。
 * WHY 独立 chunk:landscape/pool/relief 三个新 pass 共用同一套"纸墨水光"
 * 材质函数,一次投入多处复用;既有 pass 的噪声副本不 refactor(最小侵入)。
 * 每项函数必须能翻译成纸/墨/水/光的物理行为(世界观纪律,见设计稿
 * docs/plan/2026-07-23-homepage-cinema-v12-design.md 一节)。
 * quantizeTone 为 inkTone 的 JS 镜像(锁数值契约供单测,改动须双同步)。
 */

/** hash/vnoise/fbm/ign:与既有 pass 同源(数值逐位一致,防风格漂移) */
export const INK_NOISE = /* glsl */ `
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
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
`;

/**
 * 墨分五色:连续亮度量化为 levels 阶;noiseAmt>0 时阶间以噪声阈值
 * 过渡(宣纸洇化边界,非 halftone 网点)。lum/noise 均 [0,1]。
 */
export const INK_TONE = /* glsl */ `
float inkTone(float lum, float noise, float noiseAmt) {
  float levels = 5.0;
  float q = lum * levels + (noise - 0.5) * noiseAmt;
  return clamp(floor(clamp(q, 0.0, levels)) / levels, 0.0, 1.0);
}
`;

/**
 * JS 镜像:与 INK_TONE 数值契约一致(镜像取 noise=0.5 中值,
 * 锁量化网格本体:floor(clamp(lum*levels,0,levels))/levels)。
 * GLSL 侧改动时须同步本函数与 chunks.test.ts。
 */
export function quantizeTone(lum: number, noiseAmt: number): number {
  const levels = 5;
  const noise = 0.5;
  const q = lum * levels + (noise - 0.5) * noiseAmt;
  return Math.min(
    1,
    Math.max(0, Math.floor(Math.min(levels, Math.max(0, q))) / levels)
  );
}

/** 高度图求法线(Sobel 中心差分):墨与纸的物理起伏 */
export const HEIGHT_NORMAL = /* glsl */ `
vec3 heightNormal(sampler2D hTex, vec2 uv, vec2 texel, float scale) {
  float hL = texture(hTex, uv - vec2(texel.x, 0.0)).r;
  float hR = texture(hTex, uv + vec2(texel.x, 0.0)).r;
  float hD = texture(hTex, uv - vec2(0.0, texel.y)).r;
  float hU = texture(hTex, uv + vec2(0.0, texel.y)).r;
  return normalize(vec3((hL - hR) * scale, (hD - hU) * scale, 1.0));
}
`;

/** 皴法:沿坡度方向的各向异性笔触纹理(山水画山石肌理) */
export const CUN_STROKE = /* glsl */ `
float cunStroke(vec2 uv, vec2 slopeDir, float freq) {
  vec2 dir = normalize(slopeDir + vec2(1e-4, 0.0));
  vec2 across = vec2(-dir.y, dir.x);
  float along = dot(uv, dir) * freq;
  float wide = dot(uv, across) * freq * 0.18;
  return fbm(vec2(along, wide));
}
`;

/** 迎光透纸:薄处透光(thickness 低处 glow 强) */
export const PAPER_GLOW = /* glsl */ `
float paperGlow(float thickness, float backLight) {
  return (1.0 - thickness) * backLight;
}
`;

/** 平远留白:深度雾 = 山水画的空间法 */
export const MIST = /* glsl */ `
float mistLayer(float depth, float density) {
  return 1.0 - exp(-max(depth, 0.0) * density);
}
`;
