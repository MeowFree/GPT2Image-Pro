"use client";

import { Code, ImagePlus, Megaphone, Palette } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@repo/ui/components/card";

const useCaseConfig = [
  { key: "designers" as const, icon: Palette },
  { key: "marketers" as const, icon: Megaphone },
  { key: "creators" as const, icon: ImagePlus },
  { key: "developers" as const, icon: Code },
];

export function UseCasesSection() {
  const t = useTranslations("UseCases");

  return (
    <section id="use-cases" className="container py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t("label")}
          </p>
          <h2 className="mb-4 font-serif text-balance text-3xl font-medium tracking-tight md:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto max-w-2xl leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>

        {/* Use Cases Grid */}
        <div className="grid gap-6 md:grid-cols-2">
          {useCaseConfig.map((uc) => {
            const Icon = uc.icon;
            const examples = t.raw(`items.${uc.key}.examples`) as string[];
            return (
              <Card
                key={uc.key}
                className="group border-border bg-background shadow-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/30 hover:shadow-whisper"
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-foreground transition-colors duration-150 group-hover:bg-foreground group-hover:text-background">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium">
                        {t(`items.${uc.key}.title`)}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {t(`items.${uc.key}.subtitle`)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {t(`items.${uc.key}.description`)}
                  </p>
                  {/* 示例胶囊:统一 chips 语言(细边框 + muted 文字) */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {examples.map((example) => (
                      <span
                        key={example}
                        className="inline-flex rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                      >
                        {example}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
