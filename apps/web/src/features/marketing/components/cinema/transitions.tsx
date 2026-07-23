"use client";

/**
 * 三大转场的进度编排(full 态 GL uniform 驱动,自身无可见 DOM)。
 * ZoomThrough(v1.2 入画):推轨扎进画面 -> 墨坠成山(活墨聚向谷底,
 * 山形自白雾中隆起)-> 谷道飞越 -> 雾出白场 -> 墨潮回灌接墨章;
 * landscape pass 缺失/被熔断时回退 2.5D dolly 全程推入压暗;
 * lite 态退化为整层样张 scale 放大 + 压暗到墨色(纯 transform/opacity,
 * 行为不变)。
 * Multiply:图像粒子云从画布主角矩形散开,重凝为 16 格网格
 * (lite 态网格直接淡入,见 scene-multiply)。
 * PickAndReturn:选中回中的胶片接触阴影(DOM 飞回由 scene-wall 承担,
 * lite 态无 GL 晕影,DOM 飞回自足)。
 * takeover 仅在转场窗口内开启(窗口内无可交互内容)。
 */
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useTransform,
} from "framer-motion";
import { bell } from "./cinema-config";
import { centerSquareRect } from "./cinema-geometry";
import { useCinema } from "./cinema-gl";
import { useSceneProgress } from "./cinema-stage";

/** easeInCubic:穿越要有"扎进去"的加速度 */
const easeIn = (t: number) => t * t * t;

/**
 * 转场 A 穿越(v1.2 入画):dive 幕进度编排 dolly/fluid/landscape 三 pass
 * 并管理画布 takeover。分镜(v 为幕内进度):
 * [0, 0.28] dolly 推轨(暖光纤维隧道收束,不压暗——交接给白雾);
 * [0.25, 0.5] 墨坠成山:活墨向谷底聚拢(inkGather 目标 [0.5, 0.9]),
 * landscape 自全白雾中显形(fog 1->0.5,rise 0->1);
 * [0.3, 0.92] 谷道飞越(landscapeP 0->1,雾续降至 0.12);
 * [0.85, 0.95] 雾出白场(fog -> 1);[0.92, 1] 墨潮回灌接墨章。
 * landscape pass 缺失/被熔断/无引擎时回退 2.5D dolly 全程推入压暗。
 * 全部量为进度纯函数,倒放成立。
 */
export function ZoomThroughTransition() {
  const p = useSceneProgress("dive");
  const chapter = useSceneProgress("manifesto");
  const { engine, status, setTakeover } = useCinema();
  // 流体键由 dive 与 manifesto 双进度联合决定,任一变化都重算
  const feedFluid = (dive: number, manifesto: number) => {
    // 墨潮回灌:dive 末 8% 内 0->1;可见窗覆盖回灌段与 manifesto 前 10%
    engine?.setProgress("fluidP", Math.max(0, (dive - 0.92) / 0.08));
    const on = dive > 0.92 && (dive < 1 || manifesto < 0.1);
    engine?.setProgress("fluidVisible", on ? 1 : 0);
  };
  useMotionValueEvent(p, "change", (v) => {
    // takeover 只在有画布(full)时有意义,lite 无 GL 不触发状态翻转
    if (engine) setTakeover(v > 0.001 && v < 0.999);
    const landscapeOff =
      !engine || !engine.hasPass("landscape") || engine.isDisabled("landscape");
    if (landscapeOff) {
      // 回退:2.5D dolly 全程(landscape 缺失/被熔断/无引擎)
      const dv = Math.min(1, v / 0.92);
      // dolly 暗场撑到幕尾(0.999):墨潮自 0.92 起扩,fluidP<=0.001 时
      // fluid 整体跳绘,若 dolly 在 0.92 先灭会出现"全暗硬切到裸页面"
      // 的断口——dolly 压暗必须撑到墨潮接管,暗接暗无断口
      engine?.setProgress("dollyVisible", v > 0.001 && v < 0.999 ? 1 : 0);
      engine?.setProgress("dollyZoom", 1 + easeIn(dv) * 17);
      engine?.setProgress("dollySmear", 1 - Math.abs(dv * 2 - 1));
      engine?.setProgress("dollyDark", Math.max(0, (v - 0.7) / 0.22));
      engine?.setProgress("landscapeVisible", 0);
      engine?.setProgress("inkFade", 0);
      engine?.setProgress("inkGather", 0);
      // 聚拢目标同步复位缺省(同 else 分支的窗外复位语义)
      engine?.setProgress("inkGatherX", 0.5);
      engine?.setProgress("inkGatherY", 0.5);
    } else {
      const seg = (a: number, b: number) =>
        Math.max(0, Math.min(1, (v - a) / (b - a)));
      // dolly 推轨段(暖光纤维隧道收束,不压暗——交接给白雾)
      const dv = seg(0, 0.28);
      engine?.setProgress("dollyVisible", v > 0.001 && v < 0.3 ? 1 : 0);
      engine?.setProgress("dollyZoom", 1 + easeIn(dv) * 17);
      engine?.setProgress("dollySmear", 1 - Math.abs(dv * 2 - 1));
      engine?.setProgress("dollyDark", 0);
      // 墨坠成山:活墨向谷底聚拢,山形自白雾中隆起
      const inkBell = seg(0.25, 0.36) * (1 - seg(0.44, 0.55));
      engine?.setProgress("inkFade", inkBell * 0.85);
      // 聚拢目标按窗口写入,窗外复位缺省 [0.5, 0.5]:滚过 dive 再回滚
      // 到序幕时,InkMistDirector 的聚拢段读键须拿到画布中心而非谷底
      // 残留(X 两态同为 0.5 是巧合,照写保持对称可读)
      const gathering = v > 0.25 && v < 0.5;
      engine?.setProgress("inkGather", gathering ? 1 : 0);
      engine?.setProgress("inkGatherX", gathering ? 0.5 : 0.5);
      engine?.setProgress("inkGatherY", gathering ? 0.9 : 0.5);
      // 飞越与雾:自全白显形,中段雾退,末端白场
      const on = v > 0.28 && v < 0.97;
      engine?.setProgress("landscapeVisible", on ? 1 : 0);
      engine?.setProgress("landscapeP", seg(0.3, 0.92));
      engine?.setProgress("landscapeRise", seg(0.28, 0.45));
      const fogOut = 1 - seg(0.3, 0.55) * 0.88;
      const fogIn = seg(0.85, 0.95);
      engine?.setProgress("landscapeFog", Math.max(fogOut, fogIn));
    }
    feedFluid(v, chapter.get());
  });
  useMotionValueEvent(chapter, "change", (v) => {
    feedFluid(p.get(), v);
  });
  // lite 态穿越:无 dolly/流体,以整层放大 + 压暗的 DOM 简化保住段落语义
  if (status !== "full") return <LiteZoomThrough progress={p} />;
  return null;
}

/**
 * lite 态穿越层:全屏样张随 dive 进度整层放大(扎进画面的简化表达),
 * 末端 45% 压暗到墨色与宣言章底色咬合;窗口边缘 2% 淡入淡出
 * (与 SceneLayer 边缘一致),窗口外完全不可见。
 * 全部量为进度纯函数,倒放成立;transform 与透明度分层绑定(铁律)。
 */
function LiteZoomThrough({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, (v) => {
    if (v <= 0 || v >= 1) return 0;
    return Math.min(1, Math.min(v, 1 - v) / 0.02);
  });
  const scale = useTransform(progress, (v) => 1 + easeIn(v) * 1.8);
  const darkOpacity = useTransform(progress, (v) =>
    Math.max(0, (v - 0.55) / 0.45)
  );
  return (
    <motion.div
      style={{ opacity }}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <motion.img
        src="/cinema/artwork-hero.webp"
        alt=""
        style={{ scale }}
        className="h-full w-full object-cover"
      />
      <motion.div
        style={{ opacity: darkOpacity }}
        className="absolute inset-0 bg-[#0e0e0d]"
      />
    </motion.div>
  );
}

/**
 * 转场 B 增殖:multiply 幕进度映射粒子 morph 键(splashMode=1)。
 * 源矩形为画布主角规格(centerSquareRect 单一构图事实,与序幕画布
 * 同位同尺寸);每次进度变化重算矩形,顺带覆盖视口尺寸变化。
 * 全部量为进度纯函数,倒放成立;窗口外 morphP 钳制 0/1,粒子停绘。
 */
export function MultiplyTransition() {
  const p = useSceneProgress("multiply");
  const { engine } = useCinema();
  useMotionValueEvent(p, "change", (v) => {
    engine?.setProgress("splashMode", 1);
    engine?.setProgress("morphP", v);
    const r = centerSquareRect(window.innerWidth, window.innerHeight);
    engine?.setProgress("morphRectA.x", r.x);
    engine?.setProgress("morphRectA.y", r.y);
    engine?.setProgress("morphRectA.w", r.w);
    engine?.setProgress("morphRectA.h", r.h);
  });
  return null;
}

/** post 晕影基线,与 post pass 缺省值一致(核对 gl/passes/post.ts) */
const VIGNETTE_BASE = 0.35;

/**
 * 转场 C 选中回中:pick 幕胶片晕影随脱墙飞行加深再回落——
 * GL 侧的"接触阴影",视线随暗角收向回中的选中项;
 * 装裱时刻(0.86-0.98)白闪一拍(postFlash)——盖上画框玻璃的反光。
 * DOM 侧 FLIP 飞回/matte 装裱由 scene-wall 的矩形合成承担。
 * 全部量为 pickP 的钟形纯函数,两端回到 post 基线,倒放成立。
 */
export function PickAndReturnTransition() {
  const p = useSceneProgress("pick");
  const { engine } = useCinema();
  useMotionValueEvent(p, "change", (v) => {
    engine?.setProgress("postVignette", VIGNETTE_BASE + bell(v) * 0.2);
    // 玻璃反光对齐装裱完成时刻(0.62-0.78 装裱,0.7 附近盖上玻璃)
    const flash = Math.max(0, Math.min(1, (v - 0.68) / 0.14));
    engine?.setProgress("postFlash", bell(flash) * 0.5);
  });
  return null;
}
