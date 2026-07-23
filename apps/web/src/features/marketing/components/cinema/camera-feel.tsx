"use client";

/**
 * 镜头签名编排:滚动速度/手持呼吸/跟焦平面三键的全片单一事实源。
 * 速度 = useVelocity(master) 归一;手持 = 低频双正弦叠加(纹理层,
 * 只在出帧时更新,静止零成本);跟焦 = 按幕分段的目标焦平面
 * (macro 近 0.3 / 飞越中 0.65 / 其余 0.5),直喂无平滑——
 * macro/dive 边界跳变点均落在全雾时刻(dv 0.3 雾出前、0.95 全白),
 * 跳变天然不可见。
 */
import { useMotionValueEvent, useVelocity } from "framer-motion";
import { sceneProgress } from "./cinema-config";
import { useCinema } from "./cinema-gl";
import { useMaster } from "./cinema-stage";

export function CameraFeelDirector(): null {
  const master = useMaster();
  const { engine } = useCinema();
  const vel = useVelocity(master);
  useMotionValueEvent(vel, "change", (v) => {
    // 量程校准:快速滚轮 ~0.03-0.09/s、触控板猛甩 ~0.3-0.6/s,
    // x2.0 使日常快滚即见拉丝(除数 1+vel*5 达 1.3-1.9),猛甩触顶成"鞭打"
    engine?.setProgress("scrollVel", Math.min(1, Math.abs(v) * 2.0));
    const t = performance.now() * 0.0004;
    engine?.setProgress("handX", Math.sin(t * 1.7) + Math.sin(t * 2.9) * 0.5);
    engine?.setProgress("handY", Math.cos(t * 1.3) + Math.sin(t * 2.3) * 0.5);
  });
  useMotionValueEvent(master, "change", (m) => {
    const mac = sceneProgress(m, "macro");
    const dv = sceneProgress(m, "dive");
    const focus =
      mac > 0.15 && mac < 0.98 ? 0.3 : dv > 0.3 && dv < 0.95 ? 0.65 : 0.5;
    engine?.setProgress("focusDepth", focus);
  });
  return null;
}
