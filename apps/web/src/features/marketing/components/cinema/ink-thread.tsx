"use client";

/**
 * 墨线谷段系统:静默谷(SLA/FAQ 等常规流区块)页边的一段连续墨线。
 * 概念上与序幕墨滴/终幕收笔同属一根线,工程上按谷段分段:每段 SVG path
 * 经 framer-motion pathLength(即 stroke-dash 扫描)随自身滚动进度生长,
 * 相邻段首尾贴齐区块边缘衔接;线旁 sticky 的衬线罗马数字 + 步骤刻度
 * 随线体扫描过半点亮。status=static(减动效/窄屏/GL 全灭)直接呈现
 * 完成态。纯装饰层(aria-hidden + pointer-events-none),不承载正文,
 * 使用方在 relative 容器内平铺:<InkThread numeral="V" step="export" />。
 */
import { motion, useScroll, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useCinema } from "./cinema-gl";

/** 章节刻度可用的步骤键(HowItWorks 四步语汇) */
type InkStepKey = "upload" | "generate" | "export" | "completion";

/**
 * 步骤键 -> HowItWorks 命名空间标题路径。
 * WHY 单独映射:completion 的 i18n 路径不在 steps 下
 * (与 static-film 的 STEP_ITEMS 同一事实,已核对 messages)。
 */
const STEP_TITLE_PATH = {
  upload: "steps.upload.title",
  generate: "steps.generate.title",
  export: "steps.export.title",
  completion: "completion.title",
} as const satisfies Record<InkStepKey, string>;

/**
 * 谷段墨线:在最近的 relative 祖先内沿页边铺满全高。
 * @param numeral 章节罗马数字(纯排版记号,不入 i18n,与展墙编号同语汇)
 * @param step 步骤刻度键,标题取自 HowItWorks 命名空间
 * @param side 线体贴靠的页边,默认 left
 */
export function InkThread({
  numeral,
  step,
  side = "left",
}: {
  numeral: string;
  step: InkStepKey;
  side?: "left" | "right";
}) {
  const t = useTranslations("HowItWorks");
  const { status } = useCinema();
  const ref = useRef<HTMLDivElement | null>(null);
  // 自身行程:区块从视口底进入到从视口顶离开,线随行程扫描生长
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  // 函数式回调钳制(铁律):弹性滚动下 useScroll 可能瞬时越界 [0,1]
  const pathLength = useTransform(scrollYProgress, (v) =>
    Math.min(1, Math.max(0, v))
  );
  // 刻度点亮:线尾扫过中点后亮起(函数式)
  const labelOpacity = useTransform(scrollYProgress, (v) =>
    v > 0.5 ? 1 : 0
  );
  const isStatic = status === "static";

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-y-0 w-6 ${
        side === "left" ? "left-6 md:left-10" : "right-6 md:right-10"
      }`}
    >
      {/* preserveAspectRatio=none:竖线拉伸铺满谷段全高,x 向不缩放,
          发丝线宽恒为 1px;pathLength 归一后 dash 扫描与进度一一对应 */}
      <svg
        viewBox="0 0 24 400"
        preserveAspectRatio="none"
        role="presentation"
        className="absolute inset-0 h-full w-full text-muted-foreground/60"
      >
        {isStatic ? (
          <path
            d="M12 0 V 400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
          />
        ) : (
          <motion.path
            d="M12 0 V 400"
            pathLength={1}
            style={{ pathLength }}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
          />
        )}
      </svg>
      {/* 零高 sticky 骑跨点:标签随滚动驻留在线旁(仅绑透明度,无 transform) */}
      <div className="sticky top-[45vh] h-0">
        <motion.span
          style={isStatic ? undefined : { opacity: labelOpacity }}
          className={`absolute whitespace-nowrap text-[11px] uppercase tracking-widest text-muted-foreground ${
            side === "left" ? "left-4" : "right-4"
          }`}
        >
          <span className="font-serif">{numeral}</span>
          {" · "}
          {t(STEP_TITLE_PATH[step])}
        </motion.span>
      </div>
    </div>
  );
}
