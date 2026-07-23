"use client";

/**
 * 镜头签名编排:滚动速度/手持呼吸/跟焦平面三键的全片单一事实源。
 * 速度 = useVelocity(master) 归一;手持 = 低频双正弦叠加(纹理层,
 * 只在出帧时更新,静止零成本);跟焦 = 按幕分段的目标焦平面
 * (macro 近 0.3 / 飞越中 0.65 / 其余 0.5),pass 内自行平滑。
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
    engine?.setProgress("scrollVel", Math.min(1, Math.abs(v) * 0.55));
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
