"use client";

/**
 * 影片主舞台:filmTotalVh 高的行程容器 + sticky 视口。
 * WHY 单时间轴:各幕若各自 useScroll,交界处进度对不齐,转场会跳变;
 * 单 master + 纯函数窗口切分保证任意滚动位置全片状态可复现(倒放成立)。
 */
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import { createContext, type ReactNode, useContext, useRef } from "react";
import { filmTotalVh, type SceneKey, sceneProgress } from "./cinema-config";
import { useCinema } from "./cinema-gl";

const MasterContext = createContext<MotionValue<number> | null>(null);

/** 读取全片主进度 MotionValue;只能在 CinemaStage 子树内调用 */
export function useMaster(): MotionValue<number> {
  const mv = useContext(MasterContext);
  if (!mv) throw new Error("useMaster 必须在 CinemaStage 内使用");
  return mv;
}

/** 主进度切分为指定幕的幕内进度(窗口外钳制为 0/1) */
export function useSceneProgress(scene: SceneKey): MotionValue<number> {
  const master = useMaster();
  // 函数式回调(铁律):不用 range-array 版本
  return useTransform(master, (m) => sceneProgress(m, scene));
}

/**
 * 影片主舞台:提供 filmTotalVh vh 的滚动行程与 sticky 视口,
 * 并把 master 进度经 on-change 直喂 GL 引擎(不经 React 渲染)。
 */
export function CinemaStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { engine } = useCinema();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    engine?.setProgress("master", v);
  });

  return (
    <div ref={ref} style={{ height: `${filmTotalVh()}vh` }}>
      <div className="sticky top-0 h-screen overflow-hidden">
        <MasterContext.Provider value={scrollYProgress}>
          {children}
        </MasterContext.Provider>
      </div>
    </div>
  );
}

/** 单幕层:窗口外透明且不可交互;transform 由各幕内层自管,本层只管透明度 */
export function SceneLayer({
  scene,
  children,
  className,
}: {
  scene: SceneKey;
  children: ReactNode;
  className?: string;
}) {
  const master = useMaster();
  const { engine } = useCinema();
  useMotionValueEvent(master, "change", (m) => {
    engine?.setProgress(scene, sceneProgress(m, scene));
  });
  // 幕内可见:窗口边缘 2% 淡入淡出,避免交界闪切
  const opacity = useTransform(master, (m) => {
    const p = sceneProgress(m, scene);
    if (p <= 0 || p >= 1) return 0;
    const edge = 0.02;
    return Math.min(1, Math.min(p, 1 - p) / edge);
  });
  const pointerEvents = useTransform(master, (m) => {
    const p = sceneProgress(m, scene);
    return p > 0 && p < 1 ? "auto" : "none";
  });
  return (
    <motion.div
      style={{ opacity, pointerEvents }}
      className={`absolute inset-0 ${className ?? ""}`}
    >
      {children}
    </motion.div>
  );
}
