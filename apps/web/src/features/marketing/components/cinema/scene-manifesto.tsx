"use client";

/**
 * 第三幕:墨底宣言章。白衬线大字逐字点亮(字符窗口 activation),
 * 中央反转呼吸光晕。文案承接原 manifesto-section(已退役)双语内联 copy
 * (已核对原文逐字迁移:中文逐字,西文逐词),不新增 messages key。
 */
import { type MotionValue, motion, useTransform } from "framer-motion";
import { useLocale } from "next-intl";
import { useSceneProgress } from "./cinema-stage";

/**
 * 字符 i 的点亮窗口:[i/total * 0.8, i/total * 0.8 + 0.2]。
 * 窗口宽 0.2 使相邻字符点亮重叠,呈墨迹漫延而非逐格开关。
 */
function charActivation(p: number, index: number, total: number): number {
  const start = (index / total) * 0.8;
  return Math.max(0, Math.min(1, (p - start) / 0.2));
}

export function ManifestoScene() {
  const p = useSceneProgress("manifesto");
  const locale = useLocale();
  const zh = locale.startsWith("zh");
  // 与原 manifesto-section 文案逐字一致(组件已退役,本处即唯一事实)
  const text = zh
    ? "少即是多。一句话，一幅画。让创作回到语言本身。"
    : "Less, but better. One sentence, one image. Creation returns to language itself.";
  const units = zh ? Array.from(text) : text.split(" ");
  return (
    <div className="flex h-full items-center justify-center bg-[#0e0e0d]">
      {/* 反转呼吸光晕(白,极弱) */}
      <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.06] blur-3xl motion-safe:animate-[breathe_8s_ease-in-out_infinite]" />
      <p className="relative mx-auto max-w-3xl px-6 text-center font-serif text-3xl font-medium leading-[1.6] text-white md:text-5xl md:leading-[1.5]">
        {units.map((u, i) => (
          <ScrubUnit
            // 宣言文案静态有序,索引即身份(同 scroll-fx TextScrub 先例)
            // biome-ignore lint/suspicious/noArrayIndexKey: 静态字/词序列
            key={i}
            unit={u}
            index={i}
            total={units.length}
            progress={p}
            spaced={!zh}
          />
        ))}
      </p>
    </div>
  );
}

/** 单字/单词:15% 级铺底透明度随幕内进度点亮到全白,倒放成立 */
function ScrubUnit({
  unit,
  index,
  total,
  progress,
  spaced,
}: {
  unit: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
  spaced: boolean;
}) {
  const opacity = useTransform(
    progress,
    (v) => 0.14 + charActivation(v, index, total) * 0.86
  );
  return (
    <motion.span style={{ opacity }} className="inline">
      {unit}
      {spaced ? " " : ""}
    </motion.span>
  );
}
