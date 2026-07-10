"use client";

import { useTranslations } from "next-intl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/components/accordion";

export function FAQSection() {
  const t = useTranslations("FAQ");
  const faqItems = t.raw("items") as Array<{
    question: string;
    answer: string;
  }>;

  return (
    // 全幅浅底节:延续明暗交替的书页节奏
    <section className="bg-secondary/50 py-20 md:py-28">
      <div className="container">
        <div className="mx-auto max-w-3xl">
          {/* Header */}
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

          {/* FAQ Accordion - 整体收进一张白纸卡,与浅底节形成层次 */}
          <div className="rounded-lg border border-border bg-background px-6">
            <Accordion type="single" collapsible className="w-full">
              {faqItems.map((faq, index) => (
                <AccordionItem
                  key={faq.question}
                  value={`item-${index}`}
                  className="last:border-b-0"
                >
                  <AccordionTrigger className="text-left">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="leading-relaxed text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </div>
    </section>
  );
}
