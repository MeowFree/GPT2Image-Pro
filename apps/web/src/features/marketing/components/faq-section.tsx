"use client";

/**
 * 谷段三折「册页」:FAQ 的问答体剧情化(v1.0.1 跟随化)。
 * 手风琴白卡退役,改为古画论问答册页——每问一折,页边衬线编号,
 * 问句前置"问"、答句前置"答"(《林泉高致》式问答体);展开时答案
 * 如墨落纸自上而下扫入(clip-path,radix data-state 驱动,纯 CSS)。
 * v1.0.1:入场从一次性 whileInView 改为逐折绑自身视口位置的滚动
 * 跟随——折子以顶边为轴自 -50° 翻平落下(册页逐页翻开),先到先翻,
 * 滚回即折回,spring 给纸页一点重量;与影片段同一镜头语言。
 * 交互语义(单开手风琴/键盘可达)与内容原样保留;SSR/无 JS/减动效
 * 输出完成态(mounted 门闩,内容真相不依赖动画)。
 */
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/components/accordion";

/** 中文册页编号(超出回退阿拉伯序号) */
const ZH_NUMERALS = [
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
] as const;

function folioNumeral(index: number, zh: boolean): string {
  if (zh) return ZH_NUMERALS[index] ?? String(index + 1);
  return String(index + 1).padStart(2, "0");
}

/**
 * 单折:以自身进入视口的位置为翻折进度(target 元素级 useScroll),
 * 顶边为轴翻平 + 微沉降。transform(rotateX/y)与 opacity 分层绑定
 * (铁律:混绑会使订阅失效);active(挂载后且非减动效)为 false 时
 * 不挂任何滚动样式,直接呈现完成态。
 */
function FolioItem({
  index,
  question,
  answer,
  zh,
  active,
}: {
  index: number;
  question: string;
  answer: string;
  zh: boolean;
  active: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 折子顶边从视口 98% 走到 74% 的窗口内翻开(短行程,逐折跟随)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.98", "start 0.74"],
  });
  // spring:纸页翻落的重量感;目标为滚动纯函数,倒放时跟随折回
  const reveal = useSpring(
    useTransform(scrollYProgress, (v) => Math.min(1, Math.max(0, v))),
    { stiffness: 150, damping: 24 }
  );
  const rotateX = useTransform(reveal, (v) => (1 - v) * -50);
  const y = useTransform(reveal, (v) => (1 - v) * 14);
  const opacity = useTransform(reveal, (v) => Math.min(1, v * 1.6));

  return (
    <motion.div ref={ref} style={active ? { opacity } : undefined}>
      <motion.div
        style={
          active
            ? {
                rotateX,
                y,
                transformOrigin: "top center",
                transformPerspective: 900,
              }
            : undefined
        }
      >
        <AccordionItem
          value={`item-${index}`}
          className="group border-border/70"
        >
          <AccordionTrigger className="gap-4 py-5 text-left hover:no-underline">
            <span className="flex min-w-0 items-baseline gap-4">
              <span
                aria-hidden="true"
                className="shrink-0 font-serif text-xs tracking-widest text-muted-foreground/60"
              >
                {folioNumeral(index, zh)}
              </span>
              <span className="min-w-0">
                <span
                  aria-hidden="true"
                  className="mr-2 font-serif text-muted-foreground/70"
                >
                  {zh ? "问" : "Q"}
                </span>
                <span className="font-serif group-hover:underline group-hover:decoration-border group-hover:underline-offset-4">
                  {question}
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-6 pl-[calc(1rem+1.5ch)]">
            {/* 答案墨迹扫入:data-state=open 时 clip 自上而下揭开 */}
            <div className="faq-ink-reveal leading-relaxed text-muted-foreground">
              <span
                aria-hidden="true"
                className="mr-2 font-serif text-foreground/60"
              >
                {zh ? "答" : "A"}
              </span>
              {answer}
            </div>
          </AccordionContent>
        </AccordionItem>
      </motion.div>
    </motion.div>
  );
}

export function FAQSection() {
  const t = useTranslations("FAQ");
  const locale = useLocale();
  const zh = locale.startsWith("zh");
  const reduceMotion = useReducedMotion();
  // mounted 门闩:滚动跟随样式仅客户端生效,SSR/无 JS 输出完成态
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const faqItems = t.raw("items") as Array<{
    question: string;
    answer: string;
  }>;

  return (
    // 全幅浅底节:延续明暗交替的书页节奏
    <section className="bg-secondary/50 py-20 md:py-28">
      <div className="container">
        <div className="mx-auto max-w-3xl">
          <div className="mb-12 text-center">
            <p className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t("label")}
            </p>
            <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-4xl">
              {t("title")}
            </h2>
            <p className="mx-auto max-w-2xl leading-relaxed text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>

          {/* 册页:一问一折,随滚动逐页翻开;展开答案墨迹扫入 */}
          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((faq, index) => (
              <FolioItem
                key={faq.question}
                index={index}
                question={faq.question}
                answer={faq.answer}
                zh={zh}
                active={mounted && !reduceMotion}
              />
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
