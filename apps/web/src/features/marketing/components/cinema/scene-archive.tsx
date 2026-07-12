"use client";

/**
 * 第十二幕「藏」的画匣(v1.1):影片新收势——形制变换后的画作缩小
 * 降至匣口、沉入匣内(画作矩形与没入裁切由 scene-wall 的 figureRect
 * / archiveDrop 驱动,本组件只负责匣本体),匣盖自上滑合一拍,
 * 纸白题签显影(展墙罗马编号 + 作品题名,零新文案),匣下落一句
 * "存入你的画廊"(Cinema.archiveCaption)。
 * 画廊/历史能力的物质表达:作品不是消失,是收好了,随时取回。
 * 全部量为 master 纯函数,倒放即开匣取画;匣几何与 archiveDrop
 * 共用 archiveChestRect 单一事实源。渲染于 WallScene 之后
 * (DOM 序即层叠序,匣面与题签浮于画作之上)。
 */
import { motion, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { PICKED_INDEX } from "./cinema-artworks";
import { sceneProgress } from "./cinema-config";
import { archiveChestRect } from "./cinema-geometry";
import { useMaster } from "./cinema-stage";
import { ROMAN } from "./scene-wall";

/** [0,1] 钳制 */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 视口像素尺寸(与 scene-wall 同基准,resize 跟随) */
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

export function ArchiveChest() {
  const t = useTranslations("Cinema");
  const master = useMaster();
  const { vw, vh } = useViewportSize();
  const wallTitles = t.raw("wallTitles") as string[];
  const pickedTitle = wallTitles[PICKED_INDEX] ?? "";

  // 匣体淡入于画作下降前,保持到影片终点(合匣即收势画面)
  const chestOpacity = useTransform(master, (m) => {
    const p = sceneProgress(m, "archive");
    return clamp01((p - 0.04) / 0.1);
  });
  // 匣盖:画作全没后自上滑落合上口沿(一拍)
  const lidDrop = useTransform(master, (m) => {
    const p = sceneProgress(m, "archive");
    return clamp01((p - 0.74) / 0.1);
  });
  const lidY = useTransform(lidDrop, (v) => (1 - v) * -34);
  // 题签:合匣后显影(先编号题名,再一句署名)
  const sealOpacity = useTransform(master, (m) =>
    clamp01((sceneProgress(m, "archive") - 0.8) / 0.1)
  );
  const captionOpacity = useTransform(master, (m) =>
    clamp01((sceneProgress(m, "archive") - 0.88) / 0.08)
  );

  if (vw <= 0 || vh <= 0) return null;
  const chest = archiveChestRect(vw, vh);

  return (
    <motion.div
      aria-hidden="true"
      style={{
        opacity: chestOpacity,
        left: chest.x * vw,
        top: chest.y * vh,
        width: chest.w * vw,
        height: chest.h * vh,
      }}
      className="pointer-events-none absolute"
    >
      {/* 匣体:墨木色,口沿一道暗缝(画作沉入的平面) */}
      <div className="absolute inset-0 rounded-sm bg-[#2a2622] shadow-[0_20px_44px_rgba(24,20,15,0.3)]">
        <div className="absolute inset-x-1 top-0 h-[3px] rounded-full bg-black/70" />
        <div className="absolute inset-x-0 top-[34%] h-px bg-white/5" />
      </div>
      {/* 匣盖:薄板自上滑合,盖住口沿暗缝 */}
      <motion.div
        style={{ y: lidY, opacity: lidDrop }}
        className="absolute -inset-x-1 -top-1 h-2.5 rounded-sm bg-[#1f1b18] shadow-[0_6px_14px_rgba(0,0,0,0.35)]"
      />
      {/* 题签:纸白签条贴匣面(展墙编号 + 题名,与铭牌同一事实) */}
      <motion.div
        style={{ opacity: sealOpacity }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-border/40 bg-[#f5f2ea] px-4 py-1.5 shadow-sm"
      >
        <span className="whitespace-nowrap font-serif text-xs tracking-wide text-[#221d1a]">
          <span className="mr-2">{ROMAN[PICKED_INDEX] ?? ""}</span>
          {pickedTitle}
        </span>
      </motion.div>
      {/* 署名:你的画廊(特点用动画演,文字只署名) */}
      <motion.p
        style={{ opacity: captionOpacity }}
        className="absolute left-1/2 top-full mt-6 -translate-x-1/2 whitespace-nowrap text-center font-serif text-sm italic text-muted-foreground"
      >
        {t("archiveCaption")}
      </motion.p>
    </motion.div>
  );
}
