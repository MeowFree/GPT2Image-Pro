"use client";

/**
 * 第二幕:去噪奇观。画布占位 figure 经 dom-sync 喂 GL 原位绘制;
 * 画布绝对居中(与序幕 CanvasFrame 同规格同位,主角矩形全片不换位);
 * 幕内进度前 82% 驱动 denoiseP,后 18% 为显影完成的静止一拍(money shot);
 * 页边 EXIF 式采样 HUD;卖点解说词为视口右缘浮注,不挤占画布;
 * prompt 字幕常驻画布下方——打出的那句话与显影结果同框互证。
 * lite 态由 CSS 噪点罩+模糊衰减兜底(v1 中端管线)。
 */
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useTransform,
} from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { bell } from "./cinema-config";
import { useCinema } from "./cinema-gl";
import { useSceneProgress } from "./cinema-stage";
import { trackElement } from "./gl/dom-sync";

// 承接原 feature-grid(已退役)featureConfig 前三项,
// 对应 messages 的 Features.items.* 命名空间(en/zh 已核对存在)
const FEATURE_KEYS = ["ai", "multiSource", "outline"] as const;

/** 显影在幕内的完成点:其后为静止一拍,画面已成、滚动只余呼吸 */
const DEVELOP_END = 0.82;

/** 幕内窗口线性段 */
const seg = (p: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (p - a) / (b - a)));

export function GenerateScene() {
  const t = useTranslations("Features");
  const locale = useLocale();
  const p = useSceneProgress("generate");
  const { engine, status } = useCinema();
  const figureRef = useRef<HTMLDivElement | null>(null);
  const [hudStep, setHudStep] = useState(1);
  const [hudDone, setHudDone] = useState(false);

  useEffect(() => {
    if (status !== "full" || !figureRef.current || !engine) return;
    return trackElement(figureRef.current, (r) => {
      engine.setProgress("canvasRect.x", r.x);
      engine.setProgress("canvasRect.y", r.y);
      engine.setProgress("canvasRect.w", r.w);
      engine.setProgress("canvasRect.h", r.h);
    });
  }, [engine, status]);

  // 可见门初始化:sticky 布局下 figure 矩形全片常驻,若只靠 change 事件,
  // 停在幕外(首屏)时事件不触发,pass 会按缺省可见画出噪场方块
  useEffect(() => {
    if (!engine) return;
    const v = p.get();
    engine.setProgress("denoiseVisible", v > 0 && v < 1 ? 1 : 0);
  }, [engine, p]);

  useMotionValueEvent(p, "change", (v) => {
    const dev = seg(v, 0, DEVELOP_END);
    engine?.setProgress("denoiseP", dev);
    engine?.setProgress("denoiseGlow", bell(dev) * 0.6);
    engine?.setProgress("denoiseVisible", v > 0 && v < 1 ? 1 : 0);
    setHudStep(Math.max(1, Math.min(28, Math.floor(1 + dev * 27))));
    setHudDone(v >= DEVELOP_END);
  });

  // prompt 字幕:入幕即亮,静止一拍尾端(交给穿越幕前)淡出
  const promptOpacity = useTransform(p, (v) =>
    Math.min(seg(v, 0, 0.05), 1 - seg(v, 0.9, 1))
  );

  return (
    <div className="relative h-full w-full">
      {/* 画布主角:与序幕 CanvasFrame 同规格,绝对居中,全片不换位 */}
      <div
        ref={figureRef}
        className="absolute left-1/2 top-1/2 aspect-square w-[min(52vh,480px)] -translate-x-1/2 -translate-y-1/2 border border-border bg-background"
      >
        {status !== "full" ? <LiteCanvasFill progress={p} /> : null}
        <div className="absolute -bottom-8 left-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {hudDone
            ? "step 28 / 28 · complete"
            : `step ${String(hudStep).padStart(2, "0")} / 28 · denoising`}
        </div>
      </div>
      {/* 卖点解说词:视口右缘浮注,宽屏可见,不影响画布构图 */}
      <div className="absolute right-[max(2.5rem,4vw)] top-1/2 hidden w-[clamp(220px,24vw,360px)] -translate-y-1/2 lg:block">
        <div className="relative h-[420px]">
          {FEATURE_KEYS.map((key, i) => (
            <Caption
              key={key}
              index={i}
              total={FEATURE_KEYS.length}
              progress={p}
              title={t(`items.${key}.title`)}
              desc={t(`items.${key}.description`)}
            />
          ))}
        </div>
      </div>
      <PromptEcho opacity={promptOpacity} locale={locale} />
    </div>
  );
}

/**
 * prompt 字幕:序幕打出的那句话在显影全程常驻同一位置——
 * 输入与结果同框互证,主旨(一句话变成这幅画)不言自明。
 * 位置与序幕 PromptLine 完全一致,幕界交叠时视觉上是同一行字。
 */
function PromptEcho({
  opacity,
  locale,
}: {
  opacity: MotionValue<number>;
  locale: string;
}) {
  const t = useTranslations("Cinema");
  return (
    <motion.p
      style={{ opacity }}
      lang={locale}
      className="absolute bottom-[18vh] left-1/2 w-[min(80vw,560px)] -translate-x-1/2 text-center font-mono text-sm text-muted-foreground"
    >
      <span aria-hidden="true">&gt; </span>
      {t("promptSample")}
      <span className="ml-0.5 inline-block h-4 w-[7px] animate-pulse bg-foreground align-middle" />
    </motion.p>
  );
}

/** 单条解说词:在显影段内的等分窗口浮现(静止一拍期间不再换词) */
function Caption({
  index,
  total,
  progress,
  title,
  desc,
}: {
  index: number;
  total: number;
  progress: MotionValue<number>;
  title: string;
  desc: string;
}) {
  // 各解说词占显影段内等分窗口,中心全亮边缘淡出;
  // 位移与透明度分层绑定(铁律)
  const local = useTransform(progress, (v) => {
    const dev = seg(v, 0, DEVELOP_END);
    const p = (dev - index / total) * total;
    return Math.max(0, Math.min(1, p));
  });
  const y = useTransform(local, (v) => (1 - bell(v)) * 32 * (v < 0.5 ? 1 : -1));
  const opacity = useTransform(local, (v) => bell(v));
  return (
    <motion.div style={{ y }} className="absolute inset-x-0 top-1/2">
      <motion.div style={{ opacity }} className="-translate-y-1/2">
        <h3 className="mb-3 font-serif text-2xl font-medium tracking-tight">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
      </motion.div>
    </motion.div>
  );
}

/** lite 态画布填充:静态样张 + CSS 噪点罩随进度衰减 */
function LiteCanvasFill({ progress }: { progress: MotionValue<number> }) {
  const dev = useTransform(progress, (v) => seg(v, 0, DEVELOP_END));
  const noiseOpacity = useTransform(dev, (v) => 1 - v);
  const blur = useTransform(dev, (v) => `blur(${(1 - v) * 14}px)`);
  return (
    <>
      <motion.img
        src="/cinema/artwork-hero.webp"
        alt=""
        aria-hidden="true"
        style={{ filter: blur }}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <motion.div
        style={{ opacity: noiseOpacity }}
        className="absolute inset-0 bg-[repeating-conic-gradient(from_0deg,transparent_0deg,rgba(127,127,127,0.5)_1deg,transparent_2deg)]"
      />
    </>
  );
}
