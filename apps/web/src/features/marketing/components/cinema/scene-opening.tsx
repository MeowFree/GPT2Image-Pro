"use client";

/**
 * 序幕+第一幕:墨滴坠落迸溅 -> 标题墨渗显影 -> Hero 内容退场 ->
 * 画布四边发丝线合拢登场 -> prompt 逐字打出。
 * 标题真实 DOM 常驻(SEO);full 态下 DOM 字透明,GL 在原位显影。
 * i18n 沿用 Hero 命名空间(已核对原 hero-section,组件已退役:
 * 标题为 title1 + titleHighlight 两行,CTA 为 getStarted/seeDemo)。
 */
import { Button } from "@repo/ui/components/button";
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useTransform,
} from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { Link } from "@/i18n/routing";
import { useCinema } from "./cinema-gl";
import { useSceneProgress } from "./cinema-stage";
import { trackElement } from "./gl/dom-sync";

// 幕内窗口(序幕总 200vh):
// 墨滴 [0,0.10] 标题显影 [0.06,0.30] Hero 退场 [0.30,0.45]
// 画布登场 [0.42,0.58] prompt 打字 [0.58,0.95]
const seg = (p: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (p - a) / (b - a)));

export function OpeningScene() {
  const t = useTranslations("Hero");
  const locale = useLocale();
  const p = useSceneProgress("opening");
  const { engine, status } = useCinema();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  // 已登录用户点"开始创作"直接进创作页(承接原 hero-section 行为,见 issue #20)
  const { data: session } = useCurrentSession();
  const getStartedHref = session?.user ? "/dashboard/create" : "/sign-up";

  // 墨滴与标题显影 -> GL
  useMotionValueEvent(p, "change", (v) => {
    engine?.setProgress("splashMode", 0);
    engine?.setProgress("splashP", seg(v, 0, 0.1));
    engine?.setProgress("splashOx", 0.5);
    engine?.setProgress("splashOy", 0.24);
    engine?.setProgress("titleP", seg(v, 0.06, 0.3));
    engine?.setProgress("titleGlow", 0.3);
    engine?.setProgress("titleVisible", v < 0.5 ? 1 : 0);
  });

  // 标题矩形 -> GL(显影 pass 在 DOM 字原位绘制)
  useEffect(() => {
    if (status !== "full" || !titleRef.current || !engine) return;
    return trackElement(titleRef.current, (r) => {
      engine.setProgress("titleRect.x", r.x);
      engine.setProgress("titleRect.y", r.y);
      engine.setProgress("titleRect.w", r.w);
      engine.setProgress("titleRect.h", r.h);
    });
  }, [engine, status]);

  // Hero 内容退场(位移与透明度分层绑定,铁律)
  const exitP = useTransform(p, (v) => seg(v, 0.3, 0.45));
  const heroY = useTransform(exitP, (v) => v * -80);
  const heroOpacity = useTransform(exitP, (v) => 1 - v);
  // 画布登场:四条发丝线 scale 合拢
  const frameP = useTransform(p, (v) => seg(v, 0.42, 0.58));
  // prompt 打字
  const typeP = useTransform(p, (v) => seg(v, 0.58, 0.95));

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <motion.div style={{ y: heroY }} className="text-center">
        <motion.div style={{ opacity: heroOpacity }}>
          <h1
            ref={titleRef}
            className={`mx-auto max-w-4xl text-balance font-serif text-5xl font-medium leading-[1.1] tracking-tight md:text-7xl ${
              status === "full" ? "text-transparent" : ""
            }`}
          >
            {t("title1")}
            <br />
            <span className="italic">{t("titleHighlight")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>
          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <Button size="lg" className="group h-12 gap-2 px-8" asChild>
              <Link href={getStartedHref}>
                {t("getStarted")}
                <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8" asChild>
              <Link href="/#features">{t("seeDemo")}</Link>
            </Button>
          </div>
        </motion.div>
      </motion.div>
      {/* 画布主角登场位(与 GenerateScene 的 figure 同规格) */}
      <CanvasFrame frameP={frameP} />
      <PromptLine typeP={typeP} locale={locale} />
    </div>
  );
}

/** 画布四边发丝线:先横线随 scaleX 合拢,再竖线随 scaleY 生长 */
function CanvasFrame({ frameP }: { frameP: MotionValue<number> }) {
  const scaleX = useTransform(frameP, (v) => Math.min(1, v * 2));
  const scaleY = useTransform(frameP, (v) =>
    Math.max(0, Math.min(1, v * 2 - 1))
  );
  const opacity = useTransform(frameP, (v) => (v > 0 ? 1 : 0));
  return (
    <motion.div
      style={{ opacity }}
      className="absolute left-1/2 top-1/2 aspect-square w-[min(52vh,480px)] -translate-x-1/2 -translate-y-1/2"
    >
      <motion.span
        style={{ scaleX }}
        className="absolute inset-x-0 top-0 h-px origin-center bg-border"
      />
      <motion.span
        style={{ scaleX }}
        className="absolute inset-x-0 bottom-0 h-px origin-center bg-border"
      />
      <motion.span
        style={{ scaleY }}
        className="absolute inset-y-0 left-0 w-px origin-center bg-border"
      />
      <motion.span
        style={{ scaleY }}
        className="absolute inset-y-0 right-0 w-px origin-center bg-border"
      />
    </motion.div>
  );
}

/** prompt 逐字打出:字符数为打字进度的纯函数(倒放成立),光标常闪 */
function PromptLine({
  typeP,
  locale,
}: {
  typeP: MotionValue<number>;
  locale: string;
}) {
  const t = useTranslations("Cinema");
  const full = t("promptSample");
  const [shown, setShown] = useState("");
  useMotionValueEvent(typeP, "change", (v) => {
    const chars = Array.from(full);
    setShown(chars.slice(0, Math.round(v * chars.length)).join(""));
  });
  const opacity = useTransform(typeP, (v) => (v > 0 ? 1 : 0));
  return (
    <motion.p
      style={{ opacity }}
      lang={locale}
      className="absolute bottom-[18vh] left-1/2 w-[min(80vw,560px)] -translate-x-1/2 text-center font-mono text-sm text-muted-foreground"
    >
      <span aria-hidden="true">&gt; </span>
      {shown}
      <span className="ml-0.5 inline-block h-4 w-[7px] animate-pulse bg-foreground align-middle" />
    </motion.p>
  );
}
