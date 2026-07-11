"use client";

/**
 * 章节导轨:全片常驻左下角的四章指示(输入/生成/万象/交付,
 * Cinema.chapters),当前章全亮并带章内进度细线,其余三成透明。
 * 这是影片主旨的可视脊柱——任意滚动位置都能回答"现在在哪一章"。
 * 文字色随影片暗场窗口(darkWindow,与页头退场同一事实)在墨/纸
 * 两色间切换——mix-blend-difference 会被场景层的合成上下文隔离,
 * 不可依赖。依赖 useMaster,须在 CinemaStage 内。
 */
import { motion, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { darkWindow, type SceneKey, sceneWindow } from "./cinema-config";
import { useMaster } from "./cinema-stage";

/** 墨底/纸底文字色(与宣言章底色、纸面观感对应) */
const RAIL_DARK_BG_COLOR = "#f5f2ea";
const RAIL_LIGHT_BG_COLOR = "#221d1a";

/** 章 -> 幕窗口映射:每章覆盖 [首幕起点, 末幕终点) */
const CHAPTERS: readonly { first: SceneKey; last: SceneKey }[] = [
  { first: "opening", last: "opening" },
  { first: "generate", last: "manifesto" },
  { first: "multiply", last: "wall" },
  { first: "pick", last: "pick" },
];

/** 章在主进度中的窗口 */
function chapterWindow(i: number): { start: number; end: number } {
  const ch = CHAPTERS[i] ?? CHAPTERS[0];
  if (!ch) return { start: 0, end: 1 };
  return {
    start: sceneWindow(ch.first).start,
    end: sceneWindow(ch.last).end,
  };
}

export function ChapterRail() {
  const t = useTranslations("Cinema");
  const titles = t.raw("chapters") as string[];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-8 left-6 z-20 flex gap-6 md:left-10"
    >
      {CHAPTERS.map((ch, i) => (
        <ChapterItem key={ch.first} index={i} title={titles[i] ?? ""} />
      ))}
    </div>
  );
}

/** 单章条目:编号 + 标题 + 章内进度细线,活跃章全亮,随暗场反色 */
function ChapterItem({ index, title }: { index: number; title: string }) {
  const master = useMaster();
  const { start, end } = chapterWindow(index);
  const dark = darkWindow();
  const opacity = useTransform(master, (m) =>
    m >= start && m < end ? 1 : 0.35
  );
  const color = useTransform(master, (m) =>
    m >= dark.start && m < dark.end ? RAIL_DARK_BG_COLOR : RAIL_LIGHT_BG_COLOR
  );
  const scaleX = useTransform(master, (m) => {
    if (m < start) return 0;
    if (m >= end) return 1;
    return (m - start) / (end - start);
  });
  return (
    <motion.div style={{ opacity }} className="w-16">
      <motion.p
        style={{ color }}
        className="font-mono text-[11px] uppercase tracking-widest"
      >
        {String(index + 1).padStart(2, "0")} {title}
      </motion.p>
      <motion.span
        style={{ scaleX, backgroundColor: color }}
        className="mt-1.5 block h-px origin-left opacity-70"
      />
    </motion.div>
  );
}
