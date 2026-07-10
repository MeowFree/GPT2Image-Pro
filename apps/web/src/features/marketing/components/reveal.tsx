"use client";

/**
 * 营销页滚动动效原语。
 *
 * 使用方:仅限 features/marketing(framer-motion 已随营销 bundle 加载,
 * 不得被非营销路由 import,见 [locale]/layout.tsx 的 bundle 说明)。
 *
 * - Reveal: 进入视口时淡入上浮一次;respects prefers-reduced-motion。
 * - CountUp: 进入视口时数字从 0 计数到目标值(整数),用于统计数字。
 */

import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** 入场延迟(秒),用于兄弟元素错峰 */
  delay?: number;
  /** 上浮距离(px),默认 24 */
  distance?: number;
  className?: string;
}

/**
 * 进入视口触发的淡入上浮容器(只播一次)。
 * reduced-motion 环境下直接静态渲染,不做位移。
 */
export function Reveal({
  children,
  delay = 0,
  distance = 24,
  className,
}: RevealProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </motion.div>
  );
}

interface CountUpProps {
  /** 目标数值(整数部分参与计数) */
  value: number;
  /** 数字后缀,如 "K+" / "%"(不参与计数,直接拼接) */
  suffix?: string;
  className?: string;
}

/**
 * 进入视口后数字从 0 弹性计数到目标值。
 * reduced-motion 下直接显示终值。
 */
export function CountUp({ value, suffix = "", className }: CountUpProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, {
    stiffness: 55,
    damping: 18,
  });
  const [display, setDisplay] = useState(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) return;
    if (inView) motionValue.set(value);
  }, [inView, motionValue, value, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) return;
    return spring.on("change", (latest) => {
      setDisplay(Math.round(latest));
    });
  }, [spring, reduceMotion]);

  return (
    <span ref={ref} className={className}>
      {reduceMotion ? value : display}
      {suffix}
    </span>
  );
}
