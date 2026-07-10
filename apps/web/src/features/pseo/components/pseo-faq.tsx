import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui/components/accordion";

import type { PseoPage } from "../lib/pseo-data";

export function PseoFaq({ page }: { page: PseoPage }) {
  const { sections, faq } = page.data;

  return (
    // 全幅浅底节:与营销页 FAQ 同款书页节奏(bg-secondary/50 + py-20/28)
    <section className="bg-secondary/50 py-20 md:py-28" id="faq">
      <div className="container">
        <div className="mx-auto max-w-3xl">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-4xl">
              {sections.faq.title}
            </h2>
            <p className="mx-auto max-w-2xl leading-relaxed text-muted-foreground">
              {sections.faq.subtitle}
            </p>
          </div>

          {/* 手风琴收进白纸卡,与浅底节形成层次,统一营销页 FAQ 卡片语言 */}
          <div className="rounded-lg border border-border bg-background px-6">
            <Accordion type="single" collapsible className="w-full">
              {faq.map((item, index) => (
                <AccordionItem
                  key={item.question}
                  value={`item-${index}`}
                  className="last:border-b-0"
                >
                  <AccordionTrigger className="text-left">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="leading-relaxed text-muted-foreground">
                    {item.answer}
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
