"use client";

/**
 * 底部 CTA:反色"章节"压轴段。
 *
 * 视觉:全幅近黑深底(暗色主题下反转为纸白),衬线大标题 + 呼吸光晕,
 * 主按钮反色,滚动渐显入场。参考 DESIGN.md 的明暗章节交替节奏,
 * 让页面以一个视觉重音收尾。跳转逻辑与文案 key 不变。
 */

import { Button } from "@repo/ui/components/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { Reveal } from "./reveal";

export function CTASection() {
  const t = useTranslations("CTA");
  // 已登录用户点 CTA 应进创作页,而非注册/登录页(见 issue #20)。
  const { data: session } = useCurrentSession();
  const getStartedHref = session?.user ? "/dashboard/create" : "/sign-up";

  return (
    // 反色章节:bg-foreground/text-background 随明暗主题自反转
    <section className="relative overflow-hidden bg-foreground py-24 text-background md:py-32">
      {/* 深底呼吸光晕(反色低透明度) */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-background/[0.07] blur-[110px] motion-safe:animate-[breathe_10s_ease-in-out_infinite]"
      />
      <div className="container relative">
        <Reveal className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-background/25 px-4 py-1.5 text-sm text-background/70">
            {t("badge")}
          </div>

          <h2 className="mb-6 text-balance font-serif text-4xl font-medium leading-[1.15] tracking-tight md:text-5xl lg:text-6xl">
            {t("title")}
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-background/70">
            {t("subtitle")}
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            {/* 反色主按钮:深底上纸白实底 */}
            <Button
              size="lg"
              className="group h-12 gap-2 bg-background px-8 text-base text-foreground hover:bg-background/90"
              asChild
            >
              <Link href={getStartedHref}>
                {t("getStarted")}
                <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 border-background/30 bg-transparent px-8 text-base text-background hover:border-background/60 hover:bg-background/10 hover:text-background dark:border-background/30 dark:bg-transparent dark:hover:bg-background/10"
              asChild
            >
              <Link href="/dashboard/generate">{t("seeDemo")}</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
