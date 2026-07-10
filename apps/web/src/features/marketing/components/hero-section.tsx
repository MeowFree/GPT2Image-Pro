"use client";

/**
 * 营销首页 Hero:编辑部风衬线首屏。
 *
 * 视觉:呼吸光晕背景 + 分层错峰入场(badge -> 标题逐行 -> 副题 -> CTA ->
 * 信任行 -> 计数统计)。动效经 framer-motion variants 编排,
 * reduced-motion 下整体静态。功能不变:CTA 跳转逻辑与 i18n key 原样。
 */

import { Button } from "@repo/ui/components/button";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { Link } from "@/i18n/routing";
import { CountUp } from "./reveal";
import { HeroExit } from "./scroll-fx";

/** 父容器:子元素按 0.12s 错峰入场 */
const heroStagger = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

/** 子元素:淡入上浮 */
const heroItem = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.21, 0.47, 0.32, 0.98] as const },
  },
};

/** 统计数字配置:数值部分参与计数,后缀直接拼接 */
const STATS = [
  { value: 10, suffix: "K+", labelKey: "stats.cards" },
  { value: 500, suffix: "+", labelKey: "stats.users" },
  { value: 95, suffix: "%", labelKey: "stats.rating" },
] as const;

export function HeroSection() {
  const t = useTranslations("Hero");
  const reduceMotion = useReducedMotion();
  // 已登录用户点"开始创作"应直接进创作页,而非被带去注册/登录页(见 issue #20)。
  const { data: session } = useCurrentSession();
  const getStartedHref = session?.user ? "/dashboard/create" : "/sign-up";

  return (
    <section className="relative overflow-hidden py-24 md:py-32 lg:py-40">
      {/* 呼吸光晕:两团单色径向光缓慢呼吸,营造纸上晕染感(纯合成层动画) */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[520px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/[0.05] blur-[120px] motion-safe:animate-[breathe_9s_ease-in-out_infinite] dark:bg-foreground/[0.06]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[30%] top-2/3 h-[320px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/[0.03] blur-[100px] motion-safe:animate-[breathe_12s_ease-in-out_infinite_reverse] dark:bg-foreground/[0.04]"
      />

      <HeroExit>
        <motion.div
          className="container relative mx-auto flex max-w-4xl flex-col items-center"
          variants={heroStagger}
          initial={reduceMotion ? false : "hidden"}
          animate="show"
        >
          {/* Badge:胶囊语言 */}
          <motion.div variants={heroItem}>
            <Link
              href="/#features"
              className="group mb-8 inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:border-foreground/30 hover:text-foreground"
            >
              {t("badge")}
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
            </Link>
          </motion.div>

          {/* 标题:衬线巨幕,第二行斜体强调,行高 1.08 书名感 */}
          <motion.h1
            variants={heroItem}
            className="mb-8 text-center font-serif text-5xl font-medium leading-[1.08] tracking-tight md:text-6xl lg:text-7xl"
          >
            {t("title1")}
            <br />
            <span className="italic">{t("titleHighlight")}</span>
          </motion.h1>

          {/* 副题 */}
          <motion.p
            variants={heroItem}
            className="mb-12 max-w-2xl text-balance text-center text-lg leading-relaxed text-muted-foreground md:text-xl"
          >
            {t("subtitle")}
          </motion.p>

          {/* CTA:主按钮箭头悬停滑动 */}
          <motion.div
            variants={heroItem}
            className="mb-16 flex flex-col gap-4 sm:flex-row"
          >
            <Button
              size="lg"
              className="group h-12 gap-2 px-8 text-base"
              asChild
            >
              <Link href={getStartedHref}>
                {t("getStarted")}
                <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-8 text-base"
              asChild
            >
              <Link href="/#features">{t("seeDemo")}</Link>
            </Button>
          </motion.div>

          {/* 信任行:细线夹注,替代灰色头像占位 */}
          <motion.div
            variants={heroItem}
            className="mb-16 flex w-full max-w-md items-center gap-4"
          >
            <span className="h-px flex-1 bg-border" />
            <p className="shrink-0 text-sm text-muted-foreground">
              {t("trustLine")}
            </p>
            <span className="h-px flex-1 bg-border" />
          </motion.div>

          {/* 统计:入视口滚动计数,竖线分隔 */}
          <motion.div
            variants={heroItem}
            className="grid grid-cols-3 divide-x divide-border text-center"
          >
            {STATS.map((stat) => (
              <div key={stat.labelKey} className="px-8 md:px-14">
                <p className="font-serif text-3xl font-medium text-foreground md:text-4xl">
                  <CountUp value={stat.value} suffix={stat.suffix} />
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(stat.labelKey)}
                </p>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </HeroExit>
    </section>
  );
}
