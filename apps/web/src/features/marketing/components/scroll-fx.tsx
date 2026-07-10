"use client";

/**
 * 营销页滚动驱动动效引擎(Scroll-Driven Animation)。
 *
 * 使用方:仅限 features/marketing(framer-motion 已随营销 bundle 加载)。
 * 所有效果由滚动进度(useScroll + useTransform)驱动而非时间轴,
 * 随滚轮逐帧播放/倒放;只动 transform/opacity/clip-path(合成层);
 * reduced-motion 环境整体退化为静态。
 *
 * - HeroExit: 首屏内容滚动离场视差(上移 + 缩小 + 淡出)。
 * - TextScrub: 宣言文字逐词点亮(滚动进度扫过,Spotify/Apple 式)。
 * - ScrollStage: 钉住舞台 -- 高滚动区间 + sticky 视口,把区间内滚动
 *   进度交给 children 渲染函数,用于分幕播片。
 * - ExpandOnScroll: 区块随滚动从内嵌圆角卡展开为全幅(缩放+圆角收敛)。
 */

import {
  type MotionValue,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { type ReactNode, useRef } from "react";

/** 首屏滚动离场:向上视差 + 轻缩小 + 淡出(滚回则倒放) */
export function HeroExit({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);
  const opacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  if (reduceMotion) return <div>{children}</div>;
  return (
    // WHY 拆两层:framer-motion 12 实测同节点混绑 transform 与 opacity 时
    // opacity 订阅失效冻结;transform 与 opacity 分层各自绑定。
    <div ref={ref}>
      <motion.div style={{ y, scale }}>
        <motion.div style={{ opacity }}>{children}</motion.div>
      </motion.div>
    </div>
  );
}

/** 单个词:透明度随所属进度区间点亮 */
function ScrubWord({
  word,
  progress,
  range,
}: {
  word: string;
  progress: MotionValue<number>;
  range: [number, number];
}) {
  const opacity = useTransform(progress, range, [0.15, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block">
      {word}
    </motion.span>
  );
}

/**
 * 宣言文字逐词扫亮:滚动经过该区块时,词从 15% 透明度逐个点亮到全亮。
 * 中文按字符切分、西文按空格切分(传入前自行分好,以 words 数组交付)。
 */
export function TextScrub({
  words,
  className,
}: {
  words: string[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "start 0.35"],
  });

  if (reduceMotion) {
    return <p className={className}>{words.join("")}</p>;
  }
  return (
    <p ref={ref} className={className}>
      {words.map((word, index) => {
        const start = index / words.length;
        const end = (index + 1) / words.length;
        return (
          <ScrubWord
            // 宣言文案静态有序,索引即身份
            // biome-ignore lint/suspicious/noArrayIndexKey: 静态词序列
            key={index}
            word={word}
            progress={scrollYProgress}
            range={[start, end]}
          />
        );
      })}
    </p>
  );
}

/**
 * 钉住舞台:占 heightVh 的滚动区间,内容 sticky 满屏;
 * 区间滚动进度(0-1)交给 children 渲染函数驱动分幕。
 * reduced-motion 下交出恒 1 进度(静态终态)由调用方处理。
 */
export function ScrollStage({
  heightVh = 300,
  children,
}: {
  heightVh?: number;
  children: (progress: MotionValue<number>) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  return (
    <div ref={ref} style={{ height: `${heightVh}vh` }} className="relative">
      {/* 子内容自行负责垂直布局(全高交给 children,便于绝对定位到视口边缘) */}
      <div className="sticky top-0 h-screen overflow-hidden">
        {children(scrollYProgress)}
      </div>
    </div>
  );
}

/** 区块随滚动展开:从 92% 缩放 + 大圆角 -> 全幅无圆角(进入视口中段完成) */
export function ExpandOnScroll({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "start 0.25"],
  });
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const borderRadius = useTransform(scrollYProgress, [0, 1], [40, 0]);

  if (reduceMotion) return <div>{children}</div>;
  return (
    // transform(scale) 与普通样式(borderRadius) 分层绑定(同上 WHY)
    <div ref={ref}>
      <motion.div style={{ scale }}>
        <motion.div style={{ borderRadius }} className="overflow-hidden">
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}
