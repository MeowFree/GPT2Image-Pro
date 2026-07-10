"use client";

/**
 * 转场 B 增殖幕:画布残影在墨色中亮起,图像炸裂为粒子云,滚动驱动
 * 粒子在空中重凝为 16 格样张网格,底色随重凝由墨转回纸白。
 * 粒子散开/重凝全程由 GL particles pass 演出(MultiplyTransition 喂键),
 * 本组件只负责 DOM 侧:墨色罩衰减 + 重凝完成段淡入的 16 格网格。
 * 网格矩形出自 cinema-geometry.gridPos——与粒子终位同一构图事实,
 * 接管才能无跳变。依赖 useSceneProgress("multiply")。
 */
import { motion, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import { gridPos } from "./cinema-geometry";
import { useCinema } from "./cinema-gl";
import { useSceneProgress } from "./cinema-stage";

/** 展墙样张清单:现有营销素材仅主样张一张,不足 16 格由滤镜变体补足 */
const WALL_SRCS = ["/cinema/wall/w01.webp"] as const;

/** 确定性滤镜变体:灰度/对比度组合维持黑白编辑部影调,同图不同格可辨 */
const FILTERS = [
  "none",
  "grayscale(1)",
  "contrast(1.2)",
  "grayscale(1) contrast(1.25)",
  "grayscale(0.5)",
  "contrast(0.85)",
  "grayscale(1) contrast(0.9)",
  "grayscale(0.7) contrast(1.1)",
] as const;

/** 16 格静态描述:id 稳定作 React key,src/filter 由格序确定性派生 */
const GRID_CELLS = Array.from({ length: 16 }, (_, i) => ({
  id: `w${String(i + 1).padStart(2, "0")}`,
  index: i,
  src: WALL_SRCS[i % WALL_SRCS.length] ?? WALL_SRCS[0],
  filter: FILTERS[i % FILTERS.length] ?? "none",
}));

/**
 * 视口像素尺寸(客户端量取,resize 跟随)。
 * WHY 用 innerWidth/innerHeight:与 dom-sync/粒子 morph 源矩形同一
 * 坐标基准,DOM 网格与 GL 粒子终位才能逐像素对齐。
 */
function useViewportSize(): { vw: number; vh: number } {
  const [size, setSize] = useState({ vw: 0, vh: 0 });
  useEffect(() => {
    const update = () => {
      setSize({ vw: window.innerWidth, vh: window.innerHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

export function MultiplyScene() {
  const p = useSceneProgress("multiply");
  const { status } = useCinema();
  const { vw, vh } = useViewportSize();
  const isFull = status === "full";
  // 底色回纸白:墨色罩(与宣言章底色 #0e0e0d 同色)随重凝进度撤除。
  // 纯样式 MotionValue,单独节点绑定(分层铁律)。
  const backdrop = useTransform(p, (v) => `rgba(14, 14, 13, ${1 - v})`);
  // DOM 网格:full 态粒子重凝完成前不可见(粒子 p>=1 即停绘,0.82 起
  // 交叉接管);lite 态无粒子,网格在前 30% 直接淡入(v1 简化转场)
  const gridOpacity = useTransform(p, (v) =>
    isFull ? Math.max(0, (v - 0.82) / 0.18) : Math.min(1, v / 0.3)
  );
  return (
    <div className="relative h-full w-full">
      <motion.div
        style={{ backgroundColor: backdrop }}
        className="absolute inset-0"
      />
      <motion.div style={{ opacity: gridOpacity }} className="absolute inset-0">
        {vw > 0 && vh > 0
          ? GRID_CELLS.map((cell) => {
              const r = gridPos(cell.index, vw, vh);
              return (
                <figure
                  key={cell.id}
                  className="absolute m-0 overflow-hidden border border-border bg-background"
                  style={{
                    left: r.x * vw,
                    top: r.y * vh,
                    width: r.w * vw,
                    height: r.h * vh,
                  }}
                >
                  <img
                    src={cell.src}
                    alt=""
                    aria-hidden="true"
                    style={{ filter: cell.filter }}
                    className="h-full w-full object-cover"
                  />
                </figure>
              );
            })
          : null}
      </motion.div>
    </div>
  );
}
