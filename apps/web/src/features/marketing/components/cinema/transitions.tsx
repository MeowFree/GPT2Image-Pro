"use client";

/**
 * 三大转场的进度编排(GL uniform 驱动,自身无可见 DOM)。
 * ZoomThrough:镜头扎进画面,深度推轨+径向拖影+压暗,末端交给墨章。
 * Multiply:图像粒子云从画布主角矩形散开,重凝为 16 格网格。
 * PickAndReturn:选中回中的胶片接触阴影(DOM 飞回由 scene-wall 承担)。
 * takeover 仅在转场窗口内开启(窗口内无可交互内容)。
 */
import { useMotionValueEvent } from "framer-motion";
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
  const { engine, setTakeover } = useCinema();
  // 流体键由 dive 与 manifesto 双进度联合决定,任一变化都重算
  const feedFluid = (dive: number, manifesto: number) => {
    engine?.setProgress("fluidP", Math.max(0, (dive - 0.55) / 0.45));
    const on = dive > 0.001 && (dive < 1 || manifesto < 0.1);
    engine?.setProgress("fluidVisible", on ? 1 : 0);
  };
  useMotionValueEvent(p, "change", (v) => {
    const active = v > 0.001 && v < 0.999;
    setTakeover(active);
    engine?.setProgress("dollyVisible", active ? 1 : 0);
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
  return null;
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
 * GL 侧的"接触阴影",视线随暗角收向回中的选中项。
 * DOM 侧 FLIP 飞回与其余项退场由 scene-wall 的矩形合成承担。
 * 晕影量为 pickP 的钟形纯函数,两端回到 post 基线,倒放成立。
 */
export function PickAndReturnTransition() {
  const p = useSceneProgress("pick");
  const { engine } = useCinema();
  useMotionValueEvent(p, "change", (v) => {
    engine?.setProgress("postVignette", VIGNETTE_BASE + bell(v) * 0.2);
  });
  return null;
}
