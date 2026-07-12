"use client";

/**
 * 第二/三幕:去噪奇观 + 微距凝视(跨 generate/macro 两幕,自管可见性)。
 * generate:画布占位 figure 经 dom-sync 喂 GL 原位绘制,画布绝对居中
 * (与序幕 CanvasFrame 同规格同位,主角矩形全片不换位);幕内进度前 82%
 * 驱动 denoiseP(生长显影),后 18% 为显影完成的静止一拍(money shot);
 * 页边 EXIF 式采样 HUD;卖点解说词为视口右缘浮注;prompt 字幕常驻
 * 画布下方——打出的那句话与显影结果同框互证。
 * macro(v0.9):取景窗推近笔触局部(收锋飞白处)凝视->驻留漂移->拉回
 * 全幅->画布放大成方形 cover 全屏,dive 的全屏 dolly 从 zoom=1 无缝
 * 接管(内容与几何双连续)。全部量为 master 纯函数,倒放成立。
 * WHY 不套 SceneLayer:编排横跨两幕,单幕层会在幕界淡出打断连续镜头,
 * 故自管可见性(起点淡入与 SceneLayer 边缘一致,dive 前 5% 交棒淡出)。
 * lite 态由 CSS 噪点罩+模糊衰减+transform 凝视兜底。
 */
import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useTransform,
} from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { bell, sceneProgress } from "./cinema-config";
import { useCinema } from "./cinema-gl";
import { useMaster, useSceneProgress } from "./cinema-stage";
import { trackElement } from "./gl/dom-sync";

// 承接原 feature-grid(已退役)featureConfig 前三项,
// 对应 messages 的 Features.items.* 命名空间(en/zh 已核对存在)
const FEATURE_KEYS = ["ai", "multiSource", "outline"] as const;

/** 显影在幕内的完成点:其后为静止一拍,画面已成、滚动只余呼吸 */
const DEVELOP_END = 0.82;

/** 幕内窗口线性段 */
const seg = (p: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (p - a) / (b - a)));

/** easeInOutCubic:凝视推近与拉回都要有起收的呼吸感 */
function easeInOut(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u * u) / 2;
}

/**
 * macro 幕取景窗纯函数:推近笔触局部(0-0.42)->驻留缓慢漂移(0.42-0.58)
 * ->拉回全幅(0.58-0.78)。返回 denoise uCrop 的 (x, y, z);z=1 即全幅。
 * 取景中心 0.64/0.68 为一笔圆收锋飞白与起笔浓墨的交叠区(走查校准:
 * 0.40 高度对着的是右上空弧),z 最小 0.32(约 3.1 倍放大),
 * 取景窗恒在图像 [0,1] 域内(0.64+-0.16 / 0.68+-0.16)。
 */
function macroCrop(m: number): { x: number; y: number; z: number } {
  const zoomIn = easeInOut(seg(m, 0, 0.42));
  const zoomOut = easeInOut(seg(m, 0.58, 0.78));
  const gaze = Math.min(zoomIn, 1 - zoomOut);
  const drift = seg(m, 0.42, 0.58);
  return {
    x: 0.5 + (0.14 + drift * 0.02) * gaze,
    y: 0.5 + 0.18 * gaze,
    z: 1 - 0.68 * gaze,
  };
}

/** macro 幕画布放大段(0.72-1):方形 cover 全屏,为 dive 全屏交棒 */
function macroGrow(m: number): number {
  return easeInOut(seg(m, 0.72, 1));
}

export function GenerateScene() {
  const t = useTranslations("Features");
  const locale = useLocale();
  const master = useMaster();
  const p = useSceneProgress("generate");
  const macroP = useSceneProgress("macro");
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

  // GL 键统一由 master 喂(跨幕纯函数):显影进度/辉光/可见门/取景窗。
  // 可见门覆盖 generate 起点到 dive 前 5%(dolly 全屏接管前不消失,
  // 交界处两 pass 短暂共存由绘制序保证无缝)。
  const feedGL = useCallback(
    (m: number) => {
      const g = sceneProgress(m, "generate");
      const mac = sceneProgress(m, "macro");
      const d = sceneProgress(m, "dive");
      const dev = seg(g, 0, DEVELOP_END);
      engine?.setProgress("denoiseP", dev);
      engine?.setProgress("denoiseGlow", bell(dev) * 0.6);
      engine?.setProgress("denoiseVisible", g > 0 && d < 0.05 ? 1 : 0);
      const crop = macroCrop(mac);
      engine?.setProgress("canvasCrop.x", crop.x);
      engine?.setProgress("canvasCrop.y", crop.y);
      engine?.setProgress("canvasCrop.z", crop.z);
      setHudStep(Math.max(1, Math.min(28, Math.floor(1 + dev * 27))));
      setHudDone(g >= DEVELOP_END);
    },
    [engine]
  );
  useMotionValueEvent(master, "change", feedGL);
  // 初始化:sticky 布局下 figure 矩形全片常驻,停在幕外(首屏)时
  // change 不触发,pass 会按缺省可见画出噪场方块
  useEffect(() => {
    feedGL(master.get());
  }, [feedGL, master]);

  // 幕组可见性:generate 起点 3.5% 淡入(与 SceneLayer 边缘一致),
  // 贯穿 macro,dive 前 5% 淡出(dolly 已全屏接管,DOM 隐去)
  const opacity = useTransform(master, (m) => {
    const g = sceneProgress(m, "generate");
    const d = sceneProgress(m, "dive");
    if (g <= 0) return 0;
    return Math.min(1, g / 0.035) * (1 - seg(d, 0, 0.05));
  });

  // 画布宽度:基态与序幕 CanvasFrame 同规格;macro 尾段放大成方形
  // cover 全屏(超出部分由 sticky 视口 overflow-hidden 裁切)
  const canvasWidth = useTransform(master, (m) => {
    const grow = macroGrow(sceneProgress(m, "macro"));
    if (grow <= 0 || typeof window === "undefined") {
      return "min(52vh, 480px)";
    }
    const base = Math.min(window.innerHeight * 0.52, 480);
    const cover = Math.max(window.innerWidth, window.innerHeight) * 1.02;
    return `${base + (cover - base) * grow}px`;
  });

  // prompt 字幕:入幕即亮,显影段尾端淡出(macro 凝视要纯净画面)
  const promptOpacity = useTransform(p, (v) =>
    Math.min(seg(v, 0, 0.05), 1 - seg(v, 0.9, 1))
  );

  return (
    <motion.div
      data-scene="generate"
      style={{ opacity }}
      className="pointer-events-none absolute inset-0"
    >
      {/* 画布主角:与序幕 CanvasFrame 同规格,绝对居中,全片不换位;
          macro 尾段放大为全屏交棒 dive */}
      <motion.div
        ref={figureRef}
        style={{ width: canvasWidth }}
        className="absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 border border-border bg-background"
      >
        {status !== "full" ? (
          <LiteCanvasFill progress={p} macroP={macroP} />
        ) : null}
        <div className="absolute -bottom-8 left-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {hudDone
            ? "step 28 / 28 · complete"
            : `step ${String(hudStep).padStart(2, "0")} / 28 · denoising`}
        </div>
      </motion.div>
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
      <MacroNote progress={macroP} />
      <PromptEcho opacity={promptOpacity} locale={locale} />
    </motion.div>
  );
}

/**
 * 微距浮注:凝视窗口内浮现的细节论据——取景倍率 HUD + 一句注语
 * (Cinema.macroNote),推近完成前淡入、拉回前淡出。
 */
function MacroNote({ progress }: { progress: MotionValue<number> }) {
  const t = useTranslations("Cinema");
  const [detail, setDetail] = useState("1.0");
  useMotionValueEvent(progress, "change", (v) => {
    setDetail((1 / macroCrop(v).z).toFixed(1));
  });
  const opacity = useTransform(progress, (v) =>
    Math.min(seg(v, 0.1, 0.24), 1 - seg(v, 0.62, 0.74))
  );
  return (
    <motion.div
      style={{ opacity }}
      className="absolute bottom-[14vh] right-[max(2.5rem,4vw)] text-right"
    >
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        detail ×{detail}
      </p>
      <p className="mt-2 max-w-[300px] font-serif text-sm italic leading-relaxed text-muted-foreground">
        {t("macroNote")}
      </p>
    </motion.div>
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

/**
 * lite 态画布填充:静态样张 + CSS 噪点罩随进度衰减;
 * macro 凝视以 transform 放大模拟(原点对准收锋飞白处)。
 */
function LiteCanvasFill({
  progress,
  macroP,
}: {
  progress: MotionValue<number>;
  macroP: MotionValue<number>;
}) {
  const dev = useTransform(progress, (v) => seg(v, 0, DEVELOP_END));
  const noiseOpacity = useTransform(dev, (v) => 1 - v);
  const blur = useTransform(dev, (v) => `blur(${(1 - v) * 14}px)`);
  const gazeScale = useTransform(macroP, (v) => 1 / macroCrop(v).z);
  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.img
        src="/cinema/artwork-hero.webp"
        alt=""
        aria-hidden="true"
        style={{
          filter: blur,
          scale: gazeScale,
          transformOrigin: "63% 40%",
        }}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <motion.div
        style={{ opacity: noiseOpacity }}
        className="absolute inset-0 bg-[repeating-conic-gradient(from_0deg,transparent_0deg,rgba(127,127,127,0.5)_1deg,transparent_2deg)]"
      />
    </div>
  );
}
