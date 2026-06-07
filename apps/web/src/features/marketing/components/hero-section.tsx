"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { Link } from "@/i18n/routing";

export function HeroSection() {
  const t = useTranslations("Hero");
  // 已登录用户点"开始创作"应直接进创作页,而非被带去注册/登录页(见 issue #20)。
  const { data: session } = useCurrentSession();
  const getStartedHref = session?.user ? "/dashboard/create" : "/sign-up";

  return (
    <section className="container relative overflow-hidden py-20 md:py-28 lg:py-32">
      <div className="mx-auto flex max-w-4xl flex-col items-center">
        {/* Badge */}
        <Badge
          variant="outline"
          className="mb-6 gap-2 rounded-full border-foreground/20 px-4 py-2 text-sm font-medium"
        >
          {t("badge")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Badge>

        {/* Headline */}
        <h1 className="mb-6 text-center font-serif text-4xl font-medium tracking-tight md:text-5xl lg:text-6xl">
          {t("title1")}
          <br />
          <span className="text-foreground">{t("titleHighlight")}</span>
        </h1>

        {/* Subtitle */}
        <p className="mb-10 max-w-2xl text-balance text-center text-lg text-muted-foreground">
          {t("subtitle")}
        </p>

        {/* CTAs */}
        <div className="mb-16 flex flex-col gap-4 sm:flex-row">
          <Button size="lg" className="gap-2 px-8" asChild>
            <Link href={getStartedHref}>
              {t("getStarted")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/#features">{t("seeDemo")}</Link>
          </Button>
        </div>

        {/* Trust line - Avatar group */}
        <div className="mb-16 flex items-center gap-3">
          <div className="flex -space-x-2">
            {[
              "bg-foreground/10",
              "bg-foreground/20",
              "bg-foreground/30",
              "bg-foreground/40",
              "bg-foreground/50",
            ].map((shade) => (
              <div
                key={shade}
                className={`h-8 w-8 rounded-full border-2 border-background ${shade}`}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t("trustLine")}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-8 text-center md:gap-16">
          <div>
            <p className="font-serif text-3xl font-medium text-foreground">
              10K+
            </p>
            <p className="text-sm text-muted-foreground">{t("stats.cards")}</p>
          </div>
          <div>
            <p className="font-serif text-3xl font-medium text-foreground">
              500+
            </p>
            <p className="text-sm text-muted-foreground">{t("stats.users")}</p>
          </div>
          <div>
            <p className="font-serif text-3xl font-medium text-foreground">
              95%
            </p>
            <p className="text-sm text-muted-foreground">{t("stats.rating")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
