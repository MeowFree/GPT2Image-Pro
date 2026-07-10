"use client";

/**
 * 第二幕:去噪奇观。画布占位 figure 经 dom-sync 喂 GL 原位绘制;
 * 幕内进度驱动 denoiseP;页边 EXIF 式采样 HUD;FeatureGrid 卖点
 * 化作画布两侧解说词,各占等分窗口交替浮现。
 * lite 态由 CSS 噪点罩+模糊衰减兜底(v1 中端管线)。
 */
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useTransform,
} from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { bell } from "./cinema-config";
import { useCinema } from "./cinema-gl";
import { useSceneProgress } from "./cinema-stage";
import { trackElement } from "./gl/dom-sync";

// 承接原 feature-grid(已退役)featureConfig 前三项,
// 对应 messages 的 Features.items.* 命名空间(en/zh 已核对存在)
const FEATURE_KEYS = ["ai", "multiSource", "outline"] as const;

export function GenerateScene() {
  const t = useTranslations("Features");
  const p = useSceneProgress("generate");
  const { engine, status } = useCinema();
  const figureRef = useRef<HTMLDivElement | null>(null);
  const [hudStep, setHudStep] = useState(1);

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
    engine?.setProgress("denoiseP", v);
    engine?.setProgress("denoiseGlow", bell(v) * 0.6);
    engine?.setProgress("denoiseVisible", v > 0 && v < 1 ? 1 : 0);
    setHudStep(Math.max(1, Math.min(28, Math.floor(1 + v * 27))));
  });

  return (
    <div className="container flex h-full items-center justify-center gap-12">
      <div
        ref={figureRef}
        className="relative aspect-square w-[min(52vh,480px)] shrink-0 border border-border bg-background"
      >
        {status !== "full" ? <LiteCanvasFill progress={p} /> : null}
        <div className="absolute -bottom-8 left-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          step {String(hudStep).padStart(2, "0")} / 28 · denoising
        </div>
      </div>
      <div className="relative h-[420px] max-w-md flex-1">
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
  );
}

/** 单条解说词:在自己的等分窗口内浮现(中心峰值,窗口外为 0) */
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
  // 各解说词占等分窗口,中心全亮边缘淡出;位移与透明度分层绑定(铁律)
  const local = useTransform(progress, (v) => {
    const p = (v - index / total) * total;
    return Math.max(0, Math.min(1, p));
  });
  const y = useTransform(local, (v) => (1 - bell(v)) * 32 * (v < 0.5 ? 1 : -1));
  const opacity = useTransform(local, (v) => bell(v));
  return (
    <motion.div style={{ y }} className="absolute inset-x-0 top-1/2">
      <motion.div style={{ opacity }} className="-translate-y-1/2">
        <h3 className="mb-3 font-serif text-3xl font-medium tracking-tight">
          {title}
        </h3>
        <p className="leading-relaxed text-muted-foreground">{desc}</p>
      </motion.div>
    </motion.div>
  );
}

/** lite 态画布填充:静态样张 + CSS 噪点罩随进度衰减 */
function LiteCanvasFill({ progress }: { progress: MotionValue<number> }) {
  const noiseOpacity = useTransform(progress, (v) => 1 - v);
  const blur = useTransform(progress, (v) => `blur(${(1 - v) * 14}px)`);
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
