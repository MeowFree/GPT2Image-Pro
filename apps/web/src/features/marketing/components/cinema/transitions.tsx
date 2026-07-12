"use client";

/**
 * 三大转场的进度编排(full 态 GL uniform 驱动,自身无可见 DOM)。
 * ZoomThrough:镜头扎进画面,深度推轨+径向拖影+压暗,末端交给墨章;
 * lite 态退化为整层样张 scale 放大 + 压暗到墨色(纯 transform/opacity)。
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
 * 转场 A 穿越:dive 幕进度映射 dolly pass 的 uniforms 并管理画布 takeover。
 * 窗口内画布提升 z 盖过正文(dolly 全屏输出即全世界),
 * 窗口外立即归还——正文恢复可交互。全部量为进度纯函数,倒放成立。
 * 末端并喂墨水流体键:fluidP 在 dive 后 45% 内 0->1(墨吞没视口),
 * fluidVisible 覆盖 dive 全窗与 manifesto 前 10%——墨层桥接 dolly
 * 退场与宣言章 DOM 淡入之间的交界缝隙(画布层序恒在正文之上)。
 */
export function ZoomThroughTransition() {
  const p = useSceneProgress("dive");
  const chapter = useSceneProgress("manifesto");
  const { engine, status, setTakeover } = useCinema();
  // 流体键由 dive 与 manifesto 双进度联合决定,任一变化都重算
  const feedFluid = (dive: number, manifesto: number) => {
    engine?.setProgress("fluidP", Math.max(0, (dive - 0.55) / 0.45));
    const on = dive > 0.001 && (dive < 1 || manifesto < 0.1);
    engine?.setProgress("fluidVisible", on ? 1 : 0);
  };
  useMotionValueEvent(p, "change", (v) => {
    // takeover 只在有画布(full)时有意义,lite 无 GL 不触发状态翻转
    if (engine) setTakeover(v > 0.001 && v < 0.999);
    engine?.setProgress("dollyVisible", v > 0.001 && v < 0.999 ? 1 : 0);
    engine?.setProgress("dollyZoom", 1 + easeIn(v) * 17);
    // 拖影在中段最强,进出为零
    engine?.setProgress("dollySmear", 1 - Math.abs(v * 2 - 1));
    // 末端 30% 压暗到墨色,与宣言章底色 #0e0e0d 咬合
    engine?.setProgress("dollyDark", Math.max(0, (v - 0.7) / 0.3));
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
