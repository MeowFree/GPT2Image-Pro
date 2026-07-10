import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent } from "@repo/ui/components/card";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/routing";

import type { PseoPage } from "../lib/pseo-data";

export function PseoHero({ page }: { page: PseoPage }) {
  const { hero, stats } = page.data;
  const isZh = page.locale === "zh";

  return (
    <section className="container relative overflow-hidden py-20 md:py-28">
      <div className="absolute -top-20 right-0 h-56 w-56 rounded-full bg-foreground/5 blur-3xl" />
      <div className="absolute -bottom-24 left-0 h-56 w-56 rounded-full bg-foreground/5 blur-3xl" />

      <div className="mx-auto grid max-w-6xl items-center gap-12 animate-in fade-in slide-in-from-bottom-2 duration-400 motion-reduce:animate-none lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <Badge
            variant="outline"
            className="mb-6 rounded-full border-border px-4 py-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground"
          >
            {hero.badge}
          </Badge>

          <h1 className="mb-6 text-balance font-serif text-4xl font-medium leading-[1.1] tracking-tight md:text-5xl lg:text-6xl">
            {hero.title}{" "}
            <span className="text-foreground">{hero.highlight}</span>
          </h1>

          <p className="mb-8 text-lg leading-relaxed text-muted-foreground md:text-xl">
            {hero.subtitle}
          </p>

          <div className="mb-10 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="group gap-2 px-8" asChild>
              <Link href={hero.primaryCta.href}>
                {hero.primaryCta.label}
                <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href={hero.secondaryCta.href}>
                {hero.secondaryCta.label}
              </Link>
            </Button>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {stats.map((stat, index) => (
              // 统计项入场错峰:在整块淡入之上按索引 70ms 递增,
              // fill-mode backwards 避免延迟期间闪现。
              <div
                key={stat.label}
                className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-400 motion-reduce:animate-none"
                style={{
                  animationDelay: `${200 + index * 70}ms`,
                  animationFillMode: "backwards",
                }}
              >
                <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  {stat.label}
                </p>
                <p className="font-serif text-2xl font-medium tracking-tight text-foreground">
                  {stat.value}
                </p>
                <p className="text-sm text-muted-foreground">{stat.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 rounded-3xl bg-foreground/5 blur-2xl" />
          <Card className="relative overflow-hidden border-border bg-background/80 shadow-whisper">
            <CardContent className="p-6">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                {hero.summaryTitle}
              </p>
              <ul className="mt-4 space-y-3 text-sm">
                {hero.summaryItems.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-1 h-2 w-2 rounded-full bg-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 space-y-3 rounded-md bg-muted/60 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {isZh ? "分类" : "Category"}
                  </span>
                  <span className="font-medium text-foreground">
                    {page.category}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {isZh ? "语言" : "Locale"}
                  </span>
                  <span className="font-medium text-foreground">
                    {page.locale.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {isZh ? "路径" : "Slug"}
                  </span>
                  <span className="font-medium text-foreground">
                    {page.slug}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
