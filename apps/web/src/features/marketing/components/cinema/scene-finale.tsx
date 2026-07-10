"use client";

/**
 * 终幕:独立 200vh sticky 舞台(自有 useScroll,不属主影片 1550vh 行程)。
 * 反向显影 -> 白罩收纸 -> 光标+终幕语+CTA -> 尾墨滴,画布矩形与序幕
 * CanvasFrame 同规格同位(centerSquareRect 的 DOM 等价),首尾同像 bookend。
 * 幕内窗口:反向显影 [0,0.5] 白罩 [0.4,0.65] 终幕语+CTA [0.6,1] 墨滴 [0.85,1]。
 * full 态 GL 键:finaleP/finaleGlow/finaleVisible/finaleRect.*(denoise 第三
 * 实例,textMode——未显影像素输出透明,"图像逐像素退回空白纸面"而非噪场);
 * 尾墨滴直接复用 splash 键(与序幕墨溅/增殖 morph 的窗口无重叠,倒放成立)。
 * static 态渲染静态 CTA 块,承接原 CTASection 的内容职责(CTA 命名空间)。
 */
import { Button } from "@repo/ui/components/button";
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { Link } from "@/i18n/routing";
import { bell } from "./cinema-config";
import { useEngineWake } from "./cinema-film";
import { useCinema } from "./cinema-gl";
import { trackElement } from "./gl/dom-sync";
import { createDenoisePass } from "./gl/passes/denoise";

// 幕内窗口分段进度(与 scene-opening 同式局部纯函数)
const seg = (p: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (p - a) / (b - a)));

/** 终幕 denoise 实例读键(计划键名清单的 finale* 第三实例) */
const FINALE_KEYS = {
  rect: "finaleRect",
  p: "finaleP",
  glow: "finaleGlow",
  visible: "finaleVisible",
} as const;

export function FinaleStage() {
  const { status } = useCinema();
  if (status === "static") return <StaticFinale />;
  return <FinaleFilm />;
}

/** 滚动驱动的终幕(full 走 GL 反向显影,lite 走 DOM 伪显影) */
function FinaleFilm() {
  const { engine, status } = useCinema();
  const ref = useRef<HTMLDivElement | null>(null);
  const figureRef = useRef<HTMLDivElement | null>(null);
  // 舞台可见门:IntersectionObserver 结果;离场时终幕 pass 停绘,
  // 入场(v 仍为 0)即绘出成品——画布随 DOM 升入视口,bookend 无跳变
  const stageVisible = useRef(false);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  useEngineWake(ref);

  // GL 键喂入:全部量为幕内进度纯函数(倒放成立)。
  // 反向显影 p=1-seg(v,0,0.5):v=0 为成品(与影片落幅同像),0.5 处逐像素
  // 退净;0.55 后画面已全透明,停绘省帧。尾墨滴与序幕同原点(0.5,0.24)
  // ——同一滴墨再次坠落,收幕。
  const feed = useCallback(
    (v: number) => {
      if (!engine) return;
      engine.setProgress("finaleP", 1 - seg(v, 0, 0.5));
      engine.setProgress("finaleGlow", bell(seg(v, 0, 0.5)) * 0.5);
      engine.setProgress(
        "finaleVisible",
        stageVisible.current && v < 0.55 ? 1 : 0
      );
      engine.setProgress("splashMode", 0);
      engine.setProgress("splashP", seg(v, 0.85, 1));
      engine.setProgress("splashOx", 0.5);
      engine.setProgress("splashOy", 0.24);
    },
    [engine]
  );
  useMotionValueEvent(scrollYProgress, "change", feed);

  // 可见门初始化与跟踪:静置时 change 不触发,必须主动喂初值
  // (denoise 可见键缺省视为可见,不喂会在幕外画出成品方块)
  useEffect(() => {
    feed(scrollYProgress.get());
    const el = ref.current;
    if (!engine || !el) return;
    const io = new IntersectionObserver((entries) => {
      stageVisible.current = entries.some((e) => e.isIntersecting);
      feed(scrollYProgress.get());
    });
    io.observe(el);
    return () => io.disconnect();
  }, [engine, feed, scrollYProgress]);

  // 画布矩形 -> GL(trackElement 与序幕/生成幕同手法;矩形即 bookend 构图)
  useEffect(() => {
    if (status !== "full" || !figureRef.current || !engine) return;
    return trackElement(figureRef.current, (r) => {
      engine.setProgress("finaleRect.x", r.x);
      engine.setProgress("finaleRect.y", r.y);
      engine.setProgress("finaleRect.w", r.w);
      engine.setProgress("finaleRect.h", r.h);
    });
  }, [engine, status]);

  // 终幕 denoise 实例注册:textMode=true——未显影像素输出透明,反向显影的
  // 终点是空白纸面(DOM 纸底)而非噪场;卸载由 provider dispose 兜底
  useEffect(() => {
    if (!engine) return;
    let disposed = false;
    const img = new Image();
    img.src = "/cinema/artwork-hero.webp";
    img.decode().then(
      () => {
        if (!disposed) {
          engine.addPass(createDenoisePass(img, FINALE_KEYS, true));
        }
      },
      () => {
        // 资产解码失败:终幕退化为纯 DOM 演出(白罩与终幕语不受影响)
      }
    );
    return () => {
      disposed = true;
    };
  }, [engine]);

  // 白罩收纸:盖过画布残迹与页面,纸面重新铺满(纯样式,单独节点绑定)
  const coverOpacity = useTransform(scrollYProgress, (v) => seg(v, 0.4, 0.65));

  return (
    <div ref={ref} data-scene="finale" className="relative h-[200vh]">
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* 画布 bookend:与序幕 CanvasFrame 同规格(centerSquareRect DOM 等价) */}
        <div
          ref={figureRef}
          className="absolute left-1/2 top-1/2 aspect-square w-[min(52vh,480px)] -translate-x-1/2 -translate-y-1/2 border border-border bg-background"
        >
          {status !== "full" ? (
            <LiteReverseFill progress={scrollYProgress} />
          ) : null}
        </div>
        <motion.div
          style={{ opacity: coverOpacity }}
          className="pointer-events-none absolute inset-0 bg-background"
        />
        <FinaleHint progress={scrollYProgress} />
      </div>
    </div>
  );
}

/** lite 态反向显影:样张随进度加糊退场,中途过噪,终点回到纸面 */
function LiteReverseFill({ progress }: { progress: MotionValue<number> }) {
  const dissolve = useTransform(progress, (v) => seg(v, 0, 0.5));
  const imgOpacity = useTransform(dissolve, (v) => 1 - v);
  const blur = useTransform(dissolve, (v) => `blur(${v * 14}px)`);
  // 噪点走钟形:溶解中段最强,终点为 0——退回的是纸面而非噪场
  const noiseOpacity = useTransform(dissolve, (v) => bell(v));
  return (
    <>
      <motion.div style={{ opacity: imgOpacity }} className="absolute inset-0">
        <motion.img
          src="/cinema/artwork-hero.webp"
          alt=""
          aria-hidden="true"
          style={{ filter: blur }}
          className="h-full w-full object-cover"
        />
      </motion.div>
      <motion.div
        style={{ opacity: noiseOpacity }}
        className="absolute inset-0 bg-[repeating-conic-gradient(from_0deg,transparent_0deg,rgba(127,127,127,0.5)_1deg,transparent_2deg)]"
      />
    </>
  );
}

/**
 * 终幕语 + CTA:空白纸面上光标闪烁与"下一张,由你来生成",
 * 光标样式复用序幕 PromptLine;CTA 为真实 Link(SEO/可点)。
 * step04 完成刻度沿用展墙 StepTick 的页边记号语言。
 */
function FinaleHint({ progress }: { progress: MotionValue<number> }) {
  const t = useTranslations("Cinema");
  const tCta = useTranslations("CTA");
  const tHow = useTranslations("HowItWorks");
  // 已登录用户点 CTA 直接进创作页(与 cta-section 一致,见 issue #20)
  const { data: session } = useCurrentSession();
  const getStartedHref = session?.user ? "/dashboard/create" : "/sign-up";
  const appear = useTransform(progress, (v) => seg(v, 0.6, 0.75));
  // 位移与透明度分层绑定(铁律)
  const y = useTransform(appear, (v) => (1 - v) * 28);
  const pointerEvents = useTransform(progress, (v) =>
    v > 0.6 ? "auto" : "none"
  );
  return (
    <motion.div style={{ y }} className="absolute inset-0">
      <motion.div
        style={{ opacity: appear, pointerEvents }}
        className="relative flex h-full flex-col items-center justify-center gap-10"
      >
        <p className="font-mono text-base text-muted-foreground md:text-lg">
          <span aria-hidden="true">&gt; </span>
          {t("finaleHint")}
          <span className="ml-0.5 inline-block h-4 w-[7px] animate-pulse bg-foreground align-middle" />
        </p>
        <div className="flex flex-col justify-center gap-4 sm:flex-row">
          <Button size="lg" className="group h-12 gap-2 px-8" asChild>
            <Link href={getStartedHref}>
              {tCta("getStarted")}
              <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="h-12 px-8" asChild>
            <Link href="/dashboard/generate">{tCta("seeDemo")}</Link>
          </Button>
        </div>
        <p className="absolute bottom-10 left-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground md:left-10">
          04 / {tHow("completion.title")}
        </p>
      </motion.div>
    </motion.div>
  );
}

/** static 态终幕:静态 CTA 块(原 CTASection 的 badge/标题/副行/按钮) */
function StaticFinale() {
  const t = useTranslations("CTA");
  // 已登录用户点 CTA 直接进创作页(与 cta-section 一致,见 issue #20)
  const { data: session } = useCurrentSession();
  const getStartedHref = session?.user ? "/dashboard/create" : "/sign-up";
  return (
    <section className="border-t border-border py-24 md:py-32">
      <div className="container">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground">
            {t("badge")}
          </div>
          <h2 className="mb-6 text-balance font-serif text-4xl font-medium leading-[1.15] tracking-tight md:text-5xl">
            {t("title")}
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" className="group h-12 gap-2 px-8" asChild>
              <Link href={getStartedHref}>
                {t("getStarted")}
                <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8" asChild>
              <Link href="/dashboard/generate">{t("seeDemo")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
