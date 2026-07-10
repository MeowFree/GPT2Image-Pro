"use client";

import { Card, CardContent } from "@repo/ui/components/card";
import {
  Images,
  Layers,
  MessageSquare,
  Moon,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal } from "./reveal";

const featureConfig = [
  { key: "ai" as const, icon: MessageSquare },
  { key: "multiSource" as const, icon: Images },
  { key: "outline" as const, icon: Layers },
  { key: "export" as const, icon: Sparkles },
  { key: "batch" as const, icon: Wallet },
  { key: "multilingual" as const, icon: Moon },
];

export function FeatureGrid() {
  const t = useTranslations("Features");
  return (
    <section id="features" className="container py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <Reveal>
          <div className="mb-16 text-center">
            <p className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t("label")}
            </p>
            <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-5xl">
              {t("title")}
            </h2>
            <p className="mx-auto max-w-2xl leading-relaxed text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        </Reveal>

        {/* Grid - 统一卡片语言:边框卡 + 悬停提亮边框与轻阴影,错峰渐显 */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {featureConfig.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Reveal
                key={feature.key}
                delay={(index % 3) * 0.1}
                className="h-full"
              >
                <Card className="group h-full border-border bg-background shadow-none transition-[border-color,box-shadow,translate] duration-250 hover:-translate-y-1 hover:border-foreground/30 hover:shadow-whisper">
                  <CardContent className="p-6">
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-foreground/5 text-foreground transition-colors duration-150 group-hover:bg-foreground group-hover:text-background">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mb-2 font-medium">
                      {t(`items.${feature.key}.title`)}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {t(`items.${feature.key}.description`)}
                    </p>
                  </CardContent>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
