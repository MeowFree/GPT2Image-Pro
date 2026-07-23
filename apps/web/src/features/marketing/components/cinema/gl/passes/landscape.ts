/**
 * 山水飞越 pass(v1.2 奇观一「入画·千里江山」)。
 * 飞越的就是 AI 生成的真画本身:地形网格贴画作皮肤,高度图顶起
 * 山脊,墨分五色量化 + 皴法肌理 + 平远留白雾;天光为纸白云絮。
 * 单 draw 网格(gl_VertexID 派生,零缓冲区)+ 全屏天光,无 raymarch,
 * fbm <= 4 octaves,预算约 1ms;相机为进度纯函数(倒放成立)。
 * 读 progress 键:landscapeVisible(< 0.5 跳绘,缺省不可见)/
 * landscapeP(0-1 飞行进度)/landscapeFog(0-1 雾密度,1=全白场)/
 * landscapeRise(0-1 山形隆起,墨坠成山)/focusDepth(跟焦 0-1)/
 * handX/handY(手持偏移,tier<2 忽略)/scrollVel(速度,加雾流)。
 * handX/handY/scrollVel/focusDepth 由 Task 8/9 的编排喂入,
 * 未接线前恒缺省(现状即安全)。
 * cost: 3(单项熔断候选,被熔断后 dive 回退 2.5D dolly)。
 */
import {
  type CinemaPass,
  compileProgram,
  FULLSCREEN_VS,
  type PassContext,
} from "../engine";
import { CUN_STROKE, INK_NOISE, INK_TONE, MIST } from "../ink/chunks";
import { HEIGHT_SCALE, landscapeCam } from "../landscape-path";

const COLS = 128;
const ROWS = 64;
const WORLD_W = 4.4;
// 纵深:近端 0.0 在谷口(起点相机 z=+1 前方 1 单位),远端 -13 没入雾;
// 相机 z 自 +1 行至 -10.5(landscape-path),飞行深入网格内部,
// 行至身后的行由透视负 w 裁剪防护(TERRA_VS)
const WORLD_NEAR = 0.0;
const WORLD_FAR = -13.0;

const SKY_FS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uFog;
out vec4 outColor;
${INK_NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  // 纸白为底(与 denoise 纸色同源),高处略亮,云絮为淡墨丝
  vec3 paper = vec3(0.955, 0.945, 0.915);
  float wisps = fbm(vec2(uv.x * 3.1, uv.y * 1.7 + 4.2));
  float cloud = smoothstep(0.55, 0.85, wisps) * 0.06;
  vec3 col = paper - vec3(cloud);
  col = mix(col, paper, uFog);
  outColor = vec4(col, 1.0);
}`;

const TERRA_VS = `#version 300 es
precision highp float;
uniform sampler2D uHeight;
uniform vec2 uSize;
uniform vec3 uCam;
uniform vec3 uLook;
uniform float uRise;
uniform vec2 uHand;
out vec2 vUv;
out float vDepth;
out float vH;

// 网格:COLS x ROWS 个 quad,每 quad 6 顶点,全由 gl_VertexID 派生
const int COLS_I = ${COLS};
const int ROWS_I = ${ROWS};

void main() {
  int vid = gl_VertexID;
  int quad = vid / 6;
  int corner = vid - quad * 6;
  int cx = quad - (quad / COLS_I) * COLS_I;
  // 画家算法:无深度缓冲,行序翻转为远->近绘制,近景才能正确遮挡远山
  int cy = ROWS_I - 1 - (quad / COLS_I);
  // corner: 0,1,2 / 2,1,3 两三角
  ivec2 offs[4] = ivec2[4](
    ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 1)
  );
  int oi = corner == 0 ? 0 : corner == 1 ? 1 : corner == 2 ? 2
    : corner == 3 ? 2 : corner == 4 ? 1 : 3;
  ivec2 cell = ivec2(cx, cy) + offs[oi];
  vec2 grid = vec2(float(cell.x) / float(COLS_I), float(cell.y) / float(ROWS_I));
  // 世界映射:x 宽幅,z 自近及远;painting uv:v 近处贴画底
  float x = (grid.x - 0.5) * ${WORLD_W.toFixed(1)};
  float z = ${WORLD_NEAR.toFixed(1)} + grid.y * ${(WORLD_FAR - WORLD_NEAR).toFixed(1)};
  vec2 uv = vec2(grid.x, 1.0 - grid.y);
  float h = textureLod(uHeight, uv, 0.0).r;
  vec3 world = vec3(x, h * ${HEIGHT_SCALE} * uRise, z);
  // 针孔相机:手持偏移只动机位(纹理层,不动 DOM)
  vec3 cam = uCam + vec3(uHand * 0.006, 0.0);
  vec3 fwd = normalize(uLook - cam);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rel = world - cam;
  float vz = dot(rel, fwd);
  float px = dot(rel, right);
  float py = dot(rel, up);
  float focal = 1.35;
  float aspect = uSize.x / uSize.y;
  // 透视除法交给 w:NDC = (px*focal/aspect, py*focal, 0.5) / vz;
  // 身后顶点 vz<0 被 GPU 近平面裁剪,不再涂抹;varyings 透视矫正插值
  gl_Position = vec4(px * focal / aspect, py * focal, 0.5 * vz, vz);
  vUv = uv;
  vDepth = max(vz, 0.0);
  vH = h;
}`;

const TERRA_FS = `#version 300 es
precision highp float;
uniform sampler2D uPaint;
uniform sampler2D uHeight;
uniform float uFog;
uniform float uFocus;
uniform float uVel;
in vec2 vUv;
in float vDepth;
in float vH;
out vec4 outColor;
${INK_NOISE}
${INK_TONE}
${CUN_STROKE}
${MIST}
void main() {
  // 跟焦 DOF:离焦平面越远 mip 越糊(水墨晕染式 soft blur)
  float lod = clamp(abs(vDepth - uFocus * 12.0) * 0.55, 0.0, 2.6);
  vec3 art = textureLod(uPaint, vUv, lod).rgb;
  float lum = dot(art, vec3(0.299, 0.587, 0.114));
  // 墨分五色:量化阶间以画内颗粒过渡(洇化边界)
  float tone = inkTone(lum, fbm(vUv * 31.0), 0.9);
  vec3 col = mix(art, vec3(tone), 0.42);
  // 皴法:沿高度坡度的各向异性笔触,山脊肌理随高度显
  float hR = textureLod(uHeight, vUv + vec2(1.0 / 512.0, 0.0), 0.0).r;
  float hU = textureLod(uHeight, vUv + vec2(0.0, 1.0 / 256.0), 0.0).r;
  vec2 slope = vec2(hR - vH, hU - vH);
  float cun = cunStroke(vUv * 14.0, slope * 40.0, 1.0);
  col *= 1.0 - smoothstep(0.6, 0.95, cun) * 0.14 * smoothstep(0.15, 0.6, vH);
  // 平远留白:纵深雾 + 滚动速度加雾流(快滚雾动)
  float fogAmt = mistLayer(vDepth, 0.16 + uVel * 0.1);
  fogAmt = max(fogAmt, uFog);
  vec3 paper = vec3(0.955, 0.945, 0.915);
  col = mix(col, paper, clamp(fogAmt, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}`;

/** 带 mipmap 的纹理(DOF lod 采样需要;线性过滤+边缘钳制) */
function createMipTexture(
  gl: WebGL2RenderingContext,
  source: TexImageSource
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("createTexture 失败");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

export function createLandscapePass(
  paint: TexImageSource,
  height: TexImageSource
): CinemaPass {
  let skyProg: WebGLProgram | null = null;
  let terraProg: WebGLProgram | null = null;
  let paintTex: WebGLTexture | null = null;
  let heightTex: WebGLTexture | null = null;
  const skyLoc: Record<string, WebGLUniformLocation | null> = {};
  const loc: Record<string, WebGLUniformLocation | null> = {};
  return {
    key: "landscape",
    enabled: true,
    cost: 3,
    init(gl) {
      skyProg = compileProgram(gl, FULLSCREEN_VS, SKY_FS);
      terraProg = compileProgram(gl, TERRA_VS, TERRA_FS);
      paintTex = createMipTexture(gl, paint);
      heightTex = createMipTexture(gl, height);
      for (const n of ["uSize", "uFog"] as const) {
        skyLoc[n] = gl.getUniformLocation(skyProg, n);
      }
      for (const n of [
        "uHeight",
        "uSize",
        "uCam",
        "uLook",
        "uRise",
        "uHand",
        "uPaint",
        "uFog",
        "uFocus",
        "uVel",
      ] as const) {
        loc[n] = gl.getUniformLocation(terraProg, n);
      }
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!skyProg || !terraProg || !paintTex || !heightTex) return;
      if ((progress.get("landscapeVisible") ?? 0) < 0.5) return;
      const p = progress.get("landscapeP") ?? 0;
      const fog = progress.get("landscapeFog") ?? 0;
      const rise = progress.get("landscapeRise") ?? 1;
      const { pos, look } = landscapeCam(p);
      const tier = ctx.tier;
      const handX = tier >= 2 ? (progress.get("handX") ?? 0) : 0;
      const handY = tier >= 2 ? (progress.get("handY") ?? 0) : 0;
      // 天光底
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(skyProg);
      gl.uniform2f(skyLoc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(skyLoc.uFog ?? null, fog);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 地形
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(terraProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, paintTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, heightTex);
      gl.uniform1i(loc.uPaint ?? null, 0);
      gl.uniform1i(loc.uHeight ?? null, 1);
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform3f(loc.uCam ?? null, pos[0], pos[1], pos[2]);
      gl.uniform3f(loc.uLook ?? null, look[0], look[1], look[2]);
      gl.uniform1f(loc.uRise ?? null, rise);
      gl.uniform2f(loc.uHand ?? null, handX, handY);
      gl.uniform1f(loc.uFog ?? null, fog);
      gl.uniform1f(loc.uFocus ?? null, progress.get("focusDepth") ?? 0.5);
      gl.uniform1f(loc.uVel ?? null, progress.get("scrollVel") ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, COLS * ROWS * 6);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      if (skyProg) gl.deleteProgram(skyProg);
      if (terraProg) gl.deleteProgram(terraProg);
      if (paintTex) gl.deleteTexture(paintTex);
      if (heightTex) gl.deleteTexture(heightTex);
      skyProg = null;
      terraProg = null;
      paintTex = null;
      heightTex = null;
    },
  };
}
