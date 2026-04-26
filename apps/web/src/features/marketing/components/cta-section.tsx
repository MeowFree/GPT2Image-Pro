"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/components/button";

export function CTASection() {
  const t = useTranslations("CTA");

  return (
    <section className="container py-24">
      <div className="mx-auto max-w-4xl">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-background p-8 text-center md:p-16">
          <div className="relative">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-foreground/20 px-4 py-2 text-sm text-foreground">
              {t("badge")}
            </div>

            <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-4xl">
              {t("title")}
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
              {t("subtitle")}
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                size="lg"
                className="gap-2 bg-foreground text-background hover:bg-foreground/90"
                asChild
              >
                <Link href="/sign-up">
                  {t("getStarted")}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/dashboard/generate">{t("seeDemo")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
