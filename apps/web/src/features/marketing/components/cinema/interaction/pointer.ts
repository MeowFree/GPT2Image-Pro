/**
 * 指针注入:光标位置/速度喂引擎键,供流体/粒子/墨池三路消费。
 * 只在指针移动帧出帧(静止零成本);速度经 EMA 平滑并衰减,
 * touch 设备无 pointermove 自然静默。全部键:y 自顶向下视口分数。
 */
import { useEffect } from "react";
import { useCinema } from "../cinema-gl";

export function PointerFeed(): null {
  const { engine, status } = useCinema();
  useEffect(() => {
    if (!engine || status !== "full") return;
    let x = 0.5;
    let y = 0.5;
    let vx = 0;
    let vy = 0;
    let lastT = 0;
    let raf: number | null = null;
    const tick = () => {
      raf = null;
      vx *= 0.86;
      vy *= 0.86;
      const speed = Math.min(1, Math.hypot(vx, vy));
      engine.setProgress("pointer.x", x);
      engine.setProgress("pointer.y", y);
      engine.setProgress("pointer.vx", vx);
      engine.setProgress("pointer.vy", vy);
      engine.setProgress("pointer.angle", Math.atan2(vy, vx));
      engine.setProgress("pointer.speed", speed);
      if (speed > 0.015) raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth;
      const ny = e.clientY / window.innerHeight;
      const now = performance.now();
      const dt = Math.max(8, now - lastT) / 1000;
      lastT = now;
      vx = vx * 0.6 + ((nx - x) / dt) * 0.06;
      vy = vy * 0.6 + ((ny - y) / dt) * 0.06;
      x = nx;
      y = ny;
      if (raf === null) raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [engine, status]);
  return null;
}
