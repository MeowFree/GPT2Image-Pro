"use client";

/**
 * 静态编排版:status=static(reduced-motion / 窄屏 / GL 全灭)与无 JS
 * 首屏的内容真相。全部影片内容的编辑部静态重排,无滚动驱动无动效:
 * 标题/副行/prompt/CTA、卖点列表、宣言、步骤 01-04、样张网格
 * (窄屏原生横滑 snap)、引言、终幕语。i18n 全部沿用既有 key,与动效
 * 各幕消费的文案逐一同源(Hero/Features/HowItWorks/Testimonials/Cinema
 * 命名空间与宣言内联 copy);终幕 CTA 块由 FinaleStage 的 static 分支承担。
 */
import { Button } from "@repo/ui/components/button";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCurrentSession } from "@/features/auth/hooks/use-current-session";
import { Link } from "@/i18n/routing";

/** 展墙样张与滤镜变体:与 scene-multiply/scene-wall 的 16 格逐位一致 */
const WALL_SRCS = ["/cinema/wall/w01.webp"] as const;

/** 确定性滤镜变体:灰度/对比度组合维持黑白编辑部影调,同图不同格可辨 */
const FILTERS = [
  "none",
  "grayscale(1)",
  "contrast(1.2)",
  "grayscale(1) contrast(1.25)",
  "grayscale(0.5)",
  "contrast(0.85)",
  "grayscale(1) contrast(0.9)",
  "grayscale(0.7) contrast(1.1)",
] as const;

/** 16 幅样张静态描述:id 稳定作 React key,src/filter 由格序确定性派生 */
const WALL_CELLS = Array.from({ length: 16 }, (_, i) => ({
  id: `w${String(i + 1).padStart(2, "0")}`,
  src: WALL_SRCS[i % WALL_SRCS.length] ?? WALL_SRCS[0],
  filter: FILTERS[i % FILTERS.length] ?? "none",
}));

/** 卖点键序:承接原 feature-grid(已退役)featureConfig 全六项(Features.items.*) */
const FEATURE_KEYS = [
  "ai",
  "multiSource",
  "outline",
  "export",
  "batch",
  "multilingual",
] as const;

/** 步骤 01-04:HowItWorks 三步 + 完成幕(completion 的 i18n 路径不同) */
const STEP_ITEMS = [
  {
    no: "01",
    titlePath: "steps.upload.title",
    descPath: "steps.upload.description",
  },
  {
    no: "02",
    titlePath: "steps.generate.title",
    descPath: "steps.generate.description",
  },
  {
    no: "03",
    titlePath: "steps.export.title",
    descPath: "steps.export.description",
  },
  {
    no: "04",
    titlePath: "completion.title",
    descPath: "completion.description",
  },
] as const;

interface QuoteItem {
  content: string;
  author: string;
  role: string;
}

export function StaticFilm() {
  return (
    <div>
      <StaticOpening />
      <StaticFeatures />
      <StaticManifesto />
      <StaticSteps />
      <StaticWall />
      <StaticQuotes />
      <StaticFinaleLine />
    </div>
  );
}

/** 区块眉标 + 衬线标题(可选副行),沿用站点营销区块的排版语言 */
function SectionHead({
  label,
  title,
  subtitle,
}: {
  label: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="mx-auto max-w-2xl text-center">
      <p className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <h2 className="text-balance font-serif text-3xl font-medium tracking-tight md:text-4xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-4 leading-relaxed text-muted-foreground">{subtitle}</p>
      ) : null}
    </header>
  );
}

/** 序幕静态构图:标题/副行/prompt 行/CTA(Hero 与 Cinema 命名空间) */
function StaticOpening() {
  const t = useTranslations("Hero");
  const tCinema = useTranslations("Cinema");
  // 已登录用户点"开始创作"直接进创作页(承接原 hero-section 行为,见 issue #20)
  const { data: session } = useCurrentSession();
  const getStartedHref = session?.user ? "/dashboard/create" : "/sign-up";
  return (
    <section className="container flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
      <h1 className="mx-auto max-w-4xl text-balance font-serif text-5xl font-medium leading-[1.1] tracking-tight md:text-6xl">
        {t("title1")}
        <br />
        <span className="italic">{t("titleHighlight")}</span>
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        {t("subtitle")}
      </p>
      <p className="mt-8 font-mono text-sm text-muted-foreground">
        <span aria-hidden="true">&gt; </span>
        {tCinema("promptSample")}
        <span className="ml-0.5 inline-block h-4 w-[7px] bg-foreground align-middle motion-safe:animate-pulse" />
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
    </section>
  );
}

/** 卖点列表:六项编辑部细线条目(动效版仅演前三项,静态版为全量真相) */
function StaticFeatures() {
  const t = useTranslations("Features");
  return (
    <section id="features" className="container border-t border-border py-20">
      <SectionHead
        label={t("label")}
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <div className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-3">
        {FEATURE_KEYS.map((key) => (
          <div key={key} className="border-t border-border pt-4">
            <h3 className="mb-2 font-medium">{t(`items.${key}.title`)}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t(`items.${key}.description`)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 宣言墨章:文案与 scene-manifesto 内联 copy 逐字一致 */
function StaticManifesto() {
  const locale = useLocale();
  const zh = locale.startsWith("zh");
  const text = zh
    ? "少即是多。一句话，一幅画。让创作回到语言本身。"
    : "Less, but better. One sentence, one image. Creation returns to language itself.";
  return (
    <section className="bg-[#0e0e0d] py-24 md:py-32">
      <p className="container mx-auto max-w-3xl text-balance text-center font-serif text-3xl font-medium leading-[1.6] text-white md:text-4xl md:leading-[1.5]">
        {text}
      </p>
    </section>
  );
}

/** 步骤 01-04:HowItWorks 四步的编号静态列表 */
function StaticSteps() {
  const t = useTranslations("HowItWorks");
  return (
    <section className="container border-t border-border py-20">
      <SectionHead
        label={t("label")}
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <div className="mx-auto mt-12 grid max-w-4xl gap-10 md:grid-cols-2">
        {STEP_ITEMS.map((step) => (
          <div key={step.no}>
            <span className="mb-3 block font-serif text-5xl font-medium leading-none text-foreground/10">
              {step.no}
            </span>
            <h3 className="mb-2 font-serif text-xl font-medium tracking-tight">
              {t(step.titlePath)}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t(step.descPath)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 样张网格:md+ 为 4x4 网格,窄屏退化原生横滑 snap(设计稿回退阶梯) */
function StaticWall() {
  return (
    <section className="border-t border-border py-20">
      <div className="container">
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 md:grid md:grid-cols-4 md:gap-6 md:overflow-visible md:pb-0">
          {WALL_CELLS.map((cell) => (
            <figure
              key={cell.id}
              className="m-0 w-56 shrink-0 snap-center overflow-hidden border border-border md:w-auto"
            >
              <img
                src={cell.src}
                alt=""
                aria-hidden="true"
                style={{ filter: cell.filter }}
                className="aspect-square h-auto w-full object-cover"
              />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 引言:用户评价全量静态排布(动效版取前三条作观展低语) */
function StaticQuotes() {
  const t = useTranslations("Testimonials");
  const items = t.raw("items") as QuoteItem[];
  return (
    <section className="container border-t border-border py-20">
      <SectionHead label={t("label")} title={t("title")} />
      <div className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-3">
        {items.map((quote) => (
          <figure key={`${quote.author}-${quote.role}`} className="m-0">
            <blockquote className="font-serif text-sm italic leading-relaxed text-muted-foreground">
              &ldquo;{quote.content}&rdquo;
            </blockquote>
            <figcaption className="mt-3 text-xs text-muted-foreground">
              {quote.author} · {quote.role}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/** 终幕语:静态完成态的收束行(CTA 按钮块由 FinaleStage static 分支渲染) */
function StaticFinaleLine() {
  const t = useTranslations("Cinema");
  return (
    <section className="container border-t border-border py-20 text-center">
      <p className="font-mono text-sm text-muted-foreground">
        <span aria-hidden="true">&gt; </span>
        {t("finaleHint")}
        <span className="ml-0.5 inline-block h-4 w-[7px] bg-foreground align-middle motion-safe:animate-pulse" />
      </p>
    </section>
  );
}
