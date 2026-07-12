"use client";

/**
 * 谷段三折「册页」:FAQ 的问答体剧情化(v1.0)。
 * 手风琴白卡退役,改为古画论问答册页——每问一折,页边衬线编号,
 * 问句前置"问"、答句前置"答"(《林泉高致》式问答体);展开时答案
 * 如墨落纸自上而下扫入(clip-path,radix data-state 驱动,纯 CSS);
 * 整册入场逐折淡入浮起。交互语义(单开手风琴/键盘可达)原样保留。
 */
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
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

export function FAQSection() {
  const t = useTranslations("FAQ");
  const locale = useLocale();
  const zh = locale.startsWith("zh");
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

          {/* 册页:一问一折,逐折入场;展开答案墨迹扫入 */}
          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((faq, index) => (
              <motion.div
                key={faq.question}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{
                  duration: 0.55,
                  delay: index * 0.06,
                  ease: [0.22, 0.8, 0.36, 1],
                }}
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
                          {faq.question}
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
                      {faq.answer}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </motion.div>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
