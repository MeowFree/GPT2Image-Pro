/**
 * 实例化粒子 pass:gl.POINTS + gl_VertexID 派生一切,零缓冲区。
 * 模式 0 墨溅:原点迸溅+伪重力,位置是进度的纯函数(倒放成立);
 * 模式 1 布局 morph:画布矩形内均匀采样 -> 4x4 网格重排,途中曲线扰动,
 * 颜色在顶点阶段采样图像纹理(WebGL2 VS 纹理拾取)。
 * morph 按墨键控:纸底像素几乎不成粒,飞散重组的是笔画本体;
 * 暗底段粒子显作淡墨雾(负片),随底色回纸转为真实墨色。
 */
import {
  type CinemaPass,
  compileProgram,
  createTexture,
  type PassContext,
} from "../engine";

const VS = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uCount;
uniform float uMode;
uniform float uP;
uniform vec2 uOrigin;
uniform vec4 uRectA;
uniform sampler2D uImage;
out vec3 vColor;
out float vAlpha;

float hash1(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

// 视口分数 -> 裁剪空间(y 翻转:分数系自顶向下)
vec2 toClip(vec2 f) {
  return vec2(f.x * 2.0 - 1.0, (1.0 - f.y) * 2.0 - 1.0);
}

void main() {
  float i = float(gl_VertexID);
  float r1 = hash1(i);
  float r2 = hash1(i + 0.618);
  float r3 = hash1(i + 1.618);
  vec2 pos;
  float alpha;
  float size;
  vColor = vec3(0.06);
  if (uMode < 0.5) {
    // 墨溅:极角+速度散布,伪重力下坠,进度即时间
    float ang = r1 * 6.28318;
    float spd = 0.05 + r2 * 0.22;
    float t = uP;
    vec2 vel = vec2(cos(ang), sin(ang) * 0.6 - 0.4) * spd;
    pos = uOrigin + vel * t + vec2(0.0, 0.55) * t * t;
    alpha = (1.0 - t) * (0.35 + r3 * 0.5);
    size = (1.0 + r3 * 2.0) * (1.0 - t * 0.6);
  } else {
    // 布局 morph:源=uRectA 内 sqrt(uCount) 方阵采样;目标=全视口 4x4 格中心
    float side = floor(sqrt(uCount));
    float col = mod(i, side);
    float row = floor(i / side);
    vec2 srcLocal = vec2((col + 0.5) / side, (row + 0.5) / side);
    vec2 src = uRectA.xy + srcLocal * uRectA.zw;
    float tile = floor(mod(i, 16.0));
    vec2 tileCenter = vec2(
      (mod(tile, 4.0) + 0.5) / 4.0,
      (floor(tile / 4.0) + 0.5) / 4.0
    );
    // 编排分两段:前 22% 原位微爆散(笔画轮廓可辨的"碎裂瞬间"),
    // 之后才向格位收敛——立即收敛会把圆相抹成无形云
    float conv = smoothstep(0.22, 0.92, uP);
    vec2 scatter = (vec2(r2, r3) - 0.5) * 0.035 * smoothstep(0.0, 0.28, uP);
    // 目标点带瓦片内散布,重凝时收紧
    vec2 spread = (vec2(r2, r3) - 0.5) * 0.1 * (1.0 - uP);
    vec2 dst = tileCenter + spread;
    float bellP = 1.0 - abs(uP * 2.0 - 1.0);
    vec2 wander = vec2(
      sin(i * 0.37 + uP * 9.0),
      cos(i * 0.29 + uP * 7.0)
    ) * 0.012 * bellP;
    pos = mix(src + scatter, dst, conv) + wander;
    vec3 texel = texture(uImage, srcLocal).rgb;
    float srcLum = dot(texel, vec3(0.299, 0.587, 0.114));
    // 墨键控:纸底像素完全不显(alpha 与 size 双键控——数万个微透明
    // 尘点叠加会积成实心云,淹没笔画轮廓),飞散重组的是笔画本体。
    // WHY 1.0-smoothstep 而非反序边界:GLSL 规定 edge0>=edge1 未定义
    float inkAmt = 1.0 - smoothstep(0.5, 0.9, srcLum);
    // 暗底段显作淡墨雾(负片),随底色回纸转为真实墨色
    vColor = mix(vec3(0.88, 0.86, 0.81), texel, smoothstep(0.35, 0.75, uP));
    alpha = inkAmt * 0.92;
    size = (0.6 + inkAmt * 2.6) + bellP * 2.0 * inkAmt;
  }
  vAlpha = alpha;
  gl_Position = vec4(toClip(pos), 0.0, 1.0);
  gl_PointSize = size * (uSize.y / 900.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float m = smoothstep(0.5, 0.2, length(d));
  outColor = vec4(vColor, vAlpha * m);
}`;

/**
 * 创建粒子 pass。
 * 读 progress 键:splashMode(0 墨溅 / 1 布局 morph)、splashP(墨溅进度)、
 * splashOx/splashOy(墨溅原点视口分数)、morphP(morph 进度)、
 * morphRectA.x|y|w|h(morph 源矩形)。进度在 (0,1) 开区间外跳绘。
 * image 供 morph 模式顶点取色;墨溅模式可传 null。
 * 粒子数按质量档:2 档 24000 / 其余 6000。
 */
export function createParticlesPass(image: TexImageSource | null): CinemaPass {
  let prog: WebGLProgram | null = null;
  let tex: WebGLTexture | null = null;
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const names = [
    "uSize",
    "uCount",
    "uMode",
    "uP",
    "uOrigin",
    "uRectA",
    "uImage",
  ] as const;
  return {
    key: "particles",
    enabled: true,
    init(gl) {
      prog = compileProgram(gl, VS, FS);
      if (image) tex = createTexture(gl, image);
      for (const name of names) {
        loc[name] = gl.getUniformLocation(prog, name);
      }
    },
    render(ctx: PassContext) {
      const { gl, progress } = ctx;
      if (!prog) return;
      const mode = progress.get("splashMode") ?? 0;
      const p =
        mode < 0.5
          ? (progress.get("splashP") ?? 0)
          : (progress.get("morphP") ?? 0);
      if (p <= 0 || p >= 1) return;
      // morph 模式因墨键控丢弃纸底粒子(墨覆盖率约 15%),
      // 需更高采样密度补足可见粒数
      const count =
        mode < 0.5
          ? ctx.tier >= 2
            ? 24000
            : 6000
          : ctx.tier >= 2
            ? 48000
            : 12000;
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram 为 WebGL API 非 React hook
      gl.useProgram(prog);
      if (tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc.uImage ?? null, 0);
      }
      gl.enable(gl.BLEND);
      // 透明预乘画布:alpha 通道必须直通(见计划勘误一)
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA
      );
      gl.uniform2f(loc.uSize ?? null, ctx.width, ctx.height);
      gl.uniform1f(loc.uCount ?? null, count);
      gl.uniform1f(loc.uMode ?? null, mode);
      gl.uniform1f(loc.uP ?? null, p);
      gl.uniform2f(
        loc.uOrigin ?? null,
        progress.get("splashOx") ?? 0.5,
        progress.get("splashOy") ?? 0.3
      );
      gl.uniform4f(
        loc.uRectA ?? null,
        progress.get("morphRectA.x") ?? 0.3,
        progress.get("morphRectA.y") ?? 0.25,
        progress.get("morphRectA.w") ?? 0.4,
        progress.get("morphRectA.h") ?? 0.5
      );
      gl.drawArrays(gl.POINTS, 0, count);
      gl.disable(gl.BLEND);
    },
    dispose(gl) {
      if (prog) gl.deleteProgram(prog);
      if (tex) gl.deleteTexture(tex);
      prog = null;
      tex = null;
    },
  };
}
