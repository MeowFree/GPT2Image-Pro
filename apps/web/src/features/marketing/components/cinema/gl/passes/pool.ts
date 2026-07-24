/**
 * 墨池 pass(v1.2 奇观二):展墙画作映上真水面。
 * 倒影 = 图集垂直镜像重采样 + 解析波面扭曲(波幅随滚动速度)+
 * 光标涟漪;焦散 = 迭代式程序化光网(单色,缩放系数 0.08——
 * 亮网观感来自 pow 峰值,非强度上界;tier>=2 才绘)。
 * 轨道映射 GLSL 与 pool-cell.ts 双同步(改动必须两边一起)。
 * 读 progress 键:poolVisible(< 0.5 跳绘)/poolWaterY(地面线视口分数)/
 * poolGlide(展墙推轨 0-1)/poolTrackW(轨道总宽)/poolPhase(波动相位)/
 * poolAlpha(整体渐显 0-1,spread 展开期随 vis 淡入,缺省 1)/
 * scrollVel(速度加波幅,Task 9 喂)/pointer.x|y|speed(光标涟漪,Task 8 喂)。
 * cost: 2(熔断候选;被熔断时 scene-wall 恢复 DOM 倒影兜底)。
 */
import {
  STRIP_GAP,
  STRIP_H,
  STRIP_STAGGER,
  STRIP_W,
  STRIP_WHISPER_W,
} from "../../cinema-geometry";
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
uniform sampler2D uAtlas;
uniform float uWaterY;
uniform float uGlide;
uniform float uTrackW;
uniform float uPhase;
uniform float uVel;
uniform vec3 uPointer;
uniform float uTier;
uniform float uAlpha;
out vec4 outColor;

// 形制常量自 cinema-geometry 模板插值注入(与 pool-cell.ts 同一事实源,
// 消除第三副本);WHISPER 数组保留硬编码(scene-wall 的 WHISPER_AFTER
// 未导出,与 scene-wall 同一事实)
const float STRIP_W = ${STRIP_W};
const float STRIP_GAP = ${STRIP_GAP};
const float STRIP_H = ${STRIP_H};
const float STAGGER = ${STRIP_STAGGER};
const float WHISPER_W = ${STRIP_WHISPER_W};
const int WHISPER[3] = int[3](3, 8, 12);

float caustic(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy / uSize;
  float sy = 1.0 - frag.y; // 视口分数,y 自顶向下
  // 水位带早退:上界地面线,下界 = 奇格水线(+2*STAGGER)加倒影渐隐长
  // (STRIP_H*0.42);下界收不足会裁掉奇格倒影尾
  if (sy < uWaterY || sy > uWaterY + 2.0 * STAGGER + STRIP_H * 0.42) {
    outColor = vec4(0.0);
    return;
  }
  float aspect = uSize.x / uSize.y;
  // 轨道映射全部在"视口宽分数"系内进行(与 pool-cell.ts/stripPos
  // 同一单位):屏幕 x + 推轨位移复原;aspect 只用于 cover 裁切与
  // 圆形涟漪的物理等距
  float trackX = frag.x + uGlide * (uTrackW - 1.0);
  // 格序迭代收敛(与 pool-cell.ts 同算法)
  float pitch = STRIP_W + STRIP_GAP;
  int index = int(floor((trackX - STRIP_GAP) / pitch));
  for (int k = 0; k < 3; k++) {
    int wh = 0;
    for (int q = 0; q < 3; q++) {
      if (WHISPER[q] < index) wh++;
    }
    index = int(floor((trackX - STRIP_GAP - float(wh) * WHISPER_W) / pitch));
  }
  float parity = float(index - (index / 2) * 2);
  float cellWaterY = uWaterY + parity * 2.0 * STAGGER;
  float d = sy - cellWaterY; // 入水深度(视口高分数)
  // 连续墨池:水面是整片暗水(缝/低语栏位也在水下),格内才混倒影;
  // fade 随入水深度缓降(pow 1.2 比 1.6 留更多近水线层次)
  float dWater = sy - uWaterY;
  float fade = pow(max(0.0, 1.0 - dWater / (STRIP_H * 0.42)), 1.2);
  vec3 col = vec3(0.07, 0.07, 0.066); // 墨池本色
  float alpha = fade * 0.55;
  // 焦散铺满整片水面(格内格外同享):水下光网;缩放系数 0.08,
  // 且必须钳幅——pow 峰值无界会把整片水面烧白(走查实测)
  if (uTier >= 2.0) {
    float ca = min(caustic(vec2(trackX * 4.0, dWater * 4.0), uPhase * 2.0), 1.2);
    col += vec3(ca * 0.08) * fade;
    alpha = max(alpha, ca * 0.1 * fade);
  }
  // 格数 16 硬编码:与 WALL_CELL_SRCS.length(图集 4x4)耦合
  if (d > 0.0 && index >= 0 && index < 16) {
    int wh = 0;
    for (int q = 0; q < 3; q++) {
      if (WHISPER[q] < index) wh++;
    }
    float cellX = STRIP_GAP + float(index) * pitch + float(wh) * WHISPER_W;
    float u = (trackX - cellX) / STRIP_W;
    if (u >= 0.0 && u <= 1.0) {
      // 波面扭曲:深度越深晃越多;速度加波幅;光标涟漪
      float wob = 0.0035 + uVel * 0.008 + d * 0.02;
      vec2 ripple = vec2(
        sin(d * 46.0 + uPhase * 6.28) + sin(trackX * 34.0 - uPhase * 4.0),
        cos(trackX * 28.0 + uPhase * 5.1)
      ) * wob;
      // 圆形涟漪:x 以 aspect 加权恢复物理等距(pointer 键为宽分数)
      vec2 pdv = vec2((frag.x - uPointer.x) * aspect, sy - uPointer.y);
      float pd = length(pdv);
      ripple += vec2(sin(pd * 60.0 - uPhase * 18.0)) * exp(-pd * 12.0) * uPointer.z * 0.01;
      float ru = clamp(u + ripple.x, 0.0, 1.0);
      // 镜像翻转:水线处(d=0)映画底缘,深处映画高处
      float rv = clamp(1.0 - d / STRIP_H + ripple.y * 0.5, 0.0, 1.0);
      // 图集 4x4:格内 cover 裁切(画幅 0.36 宽 x 0.52 高,源图方形)
      float cellAspect = (STRIP_W * aspect) / STRIP_H;
      vec2 cellUv = vec2(ru, rv);
      if (cellAspect < 1.0) {
        cellUv.x = 0.5 + (ru - 0.5) * cellAspect;
      } else {
        cellUv.y = 0.5 + (rv - 0.5) / cellAspect;
      }
      vec2 atlasUv = (vec2(float(index - (index / 4) * 4), float(index / 4)) + cellUv) * 0.25;
      vec3 refl = texture(uAtlas, atlasUv).rgb;
      // 墨池是暗水:倒影混入后整体压暗,暗池托画(走查实测:alpha 0.5
      // 的浅灰洗在纸底上不可见,需暗色水体与更高不透明度)
      col = mix(col, refl * 0.72, fade * 0.75);
      alpha = max(alpha, fade * 0.85);
    }
  }
  // uAlpha 整体渐显:spread 展开期倒影随 vis 淡入,不作硬切
  outColor = vec4(col, alpha * uAlpha);
}`;

export function createPoolPass(atlas: TexImageSource): CinemaPass {
  let prog: WebGLProgram | null = null;
  let atlasTex: WebGLTexture | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const names = [
    "uSize",
    "uAtlas",
    "uWaterY",
    "uGlide",
    "uTrackW",
    "uPhase",
    "uVel",
    "uPointer",
    "uTier",
    "uAlpha",
  ] as const;
  return {
    key: "pool",
    enabled: true,
    cost: 2,
    init(gl) {
      prog = compileProgram(gl, FULLSCREEN_VS, FS);
      atlasTex = createTexture(gl, atlas);
      for (const name of names) {
        loc[name] = gl.getUniformLocation(prog, name);
      }
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!prog || !atlasTex) return;
      if ((progress.get("poolVisible") ?? 0) < 0.5) return;
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      // 透明预乘画布:alpha 通道直通(与 post/particles 同一勘误)
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(loc.uAtlas ?? null, 0);
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(loc.uWaterY ?? null, progress.get("poolWaterY") ?? 0.8);
      gl.uniform1f(loc.uGlide ?? null, progress.get("poolGlide") ?? 0);
      gl.uniform1f(loc.uTrackW ?? null, progress.get("poolTrackW") ?? 7.5);
      gl.uniform1f(loc.uPhase ?? null, progress.get("poolPhase") ?? 0);
      gl.uniform1f(loc.uVel ?? null, progress.get("scrollVel") ?? 0);
      gl.uniform3f(
        loc.uPointer ?? null,
        progress.get("pointer.x") ?? -1,
        progress.get("pointer.y") ?? -1,
        progress.get("pointer.speed") ?? 0
      );
      gl.uniform1f(loc.uTier ?? null, ctx.tier);
      gl.uniform1f(loc.uAlpha ?? null, progress.get("poolAlpha") ?? 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      if (atlasTex) gl.deleteTexture(atlasTex);
      prog = null;
      atlasTex = null;
    },
  };
}
