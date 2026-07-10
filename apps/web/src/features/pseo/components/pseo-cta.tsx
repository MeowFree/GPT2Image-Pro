import { MessageCircle } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { Link } from "@/i18n/routing";

import type { PseoPage } from "../lib/pseo-data";

export function PseoCta({ page }: { page: PseoPage }) {
  const { cta } = page.data;

  return (
    <section className="container py-20 md:py-28" id="cta">
      <div className="mx-auto max-w-4xl">
        {/* 反色收束卡:前景色作底、背景色作字,单色体系内的强对比终章 */}
        <div className="relative overflow-hidden rounded-xl bg-foreground px-8 py-12 text-center text-background md:px-16 md:py-16">
          <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-background/10 blur-3xl" />
          <div className="absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-background/10 blur-3xl" />

          <div className="relative">
            <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-4xl">
              {cta.title}
            </h2>
            <p className="mx-auto mb-8 max-w-2xl leading-relaxed text-background/80">
              {cta.description}
            </p>

            <div className="mb-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="gap-2 bg-background text-foreground hover:bg-background/90"
                asChild
              >
                <Link href={cta.primaryCta.href}>
                  <MessageCircle className="h-4 w-4" />
                  {cta.primaryCta.label}
                </Link>
              </Button>
              {/* outline 变体自带 bg-background,在反色底上须显式置透明,否则白底白字不可见 */}
              <Button
                size="lg"
                variant="outline"
                className="border-background/40 bg-transparent text-background hover:bg-background/10 hover:text-background dark:border-background/40 dark:bg-transparent dark:hover:bg-background/10"
                asChild
              >
                <Link href={cta.secondaryCta.href}>
                  {cta.secondaryCta.label}
                </Link>
              </Button>
            </div>

            <p className="text-sm text-background/70">{cta.note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
