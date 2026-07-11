"use client";

/**
 * 第四幕展墙 + 转场 C 选中回中。
 * 16 格网格拉开成横向展墙,竖滚驱动横向推轨;衬线铭牌罗马编号,
 * 用户评价化作画框缝隙间的观展低语;pick 幕中央一幅(index 7)脱墙
 * 飞回视口中央成画布主角规格(与序幕 bookend 同构图),其余项淡出微散。
 * 每格矩形 = gridPos -> stripPos -> centerSquareRect 三段进度合成,
 * 全部为 master 的纯函数,任意滚动位置可复现(倒放成立)。
 * WHY 不套 SceneLayer:编排横跨 wall 与 pick 两幕,单幕层会在幕界
 * 淡出打断飞回,故本组件自管可见性(起点淡入与 SceneLayer 边缘一致)。
 * 依赖 useMaster;GL 侧接触阴影由 transitions 的 PickAndReturnTransition 喂键。
 */
import { motion, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cellSrc, PICKED_INDEX } from "./cinema-artworks";
import { sceneProgress } from "./cinema-config";
import {
  centerSquareRect,
  gridPos,
  mixRect,
  stripPos,
} from "./cinema-geometry";
import { useMaster } from "./cinema-stage";
import type { ViewportRect } from "./gl/dom-sync";

/**
 * 16 幅展品静态描述:样张出自 cinema-artworks 事实源(与增殖网格
 * 逐位一致,幕界同格同图接管才无跳变),id 稳定作 React key。
 */
const WALL_CELLS = Array.from({ length: 16 }, (_, i) => ({
  id: `cell${String(i + 1).padStart(2, "0")}`,
  index: i,
  src: cellSrc(i),
}));

/** 展墙罗马编号 I-XVI:纯排版记号,不入 i18n */
const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
] as const;

/** 观展低语插在这些格序之后的缝隙里(Testimonials 引言取前三条) */
const WHISPER_AFTER = [3, 8, 12] as const;

/** 网格拉开段在 wall 幕内的占比:0-0.15 拉开,0.15-1 推轨 */
const SPREAD_WINDOW = 0.15;

/** [0,1] 钳制 */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** easeInOutCubic:拉开与回中都要有起收的呼吸感 */
function easeInOut(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u * u) / 2;
}

/** wall 幕内两段进度:spread 网格拉开成横条,glide 横条整体左移 */
function wallPhases(wallP: number): { spread: number; glide: number } {
  return {
    spread: clamp01(wallP / SPREAD_WINDOW),
    glide: clamp01((wallP - SPREAD_WINDOW) / (1 - SPREAD_WINDOW)),
  };
}

/**
 * 第 i 幅展品的合成矩形(视口分数):
 * 拉开(gridPos->stripPos) -> 推轨(轨道归一化左移) -> 选中回中/微散。
 * master 单值纯函数——三段连续合成,幕界处逐位咬合。
 */
function figureRect(
  i: number,
  master: number,
  vw: number,
  vh: number
): ViewportRect {
  const wallP = sceneProgress(master, "wall");
  const pickP = sceneProgress(master, "pick");
  const { spread, glide } = wallPhases(wallP);
  const strip = stripPos(i, WALL_CELLS.length, vw, vh);
  const base = mixRect(gridPos(i, vw, vh), strip, easeInOut(spread));
  const glided: ViewportRect = {
    ...base,
    x: base.x - glide * (strip.trackWidth - 1),
  };
  if (i === PICKED_INDEX) {
    return mixRect(glided, centerSquareRect(vw, vh), easeInOut(pickP));
  }
  // 其余项随 pick 垂直微散(±3vh,方向按奇偶),与淡出叠加成让位感
  return {
    ...glided,
    y: glided.y + pickP * 0.03 * (i % 2 === 0 ? -1 : 1),
  };
}

/**
 * 视口像素尺寸(客户端量取,resize 跟随)。
 * WHY 用 innerWidth/innerHeight:与 scene-multiply 网格、GL 粒子
 * morph 源矩形同一坐标基准,幕界接管才能逐像素对齐。
 */
function useViewportSize(): { vw: number; vh: number } {
  const [size, setSize] = useState({ vw: 0, vh: 0 });
  useEffect(() => {
    const update = () => {
      setSize({ vw: window.innerWidth, vh: window.innerHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

export function WallScene() {
  const tCinema = useTranslations("Cinema");
  const tHow = useTranslations("HowItWorks");
  const tQuotes = useTranslations("Testimonials");
  const master = useMaster();
  const { vw, vh } = useViewportSize();
  // 铭牌题名:与 cinema-artworks 清单逐位对应的 16 个作品名
  const wallTitles = tCinema.raw("wallTitles") as string[];
  const quotes = (
    tQuotes.raw("items") as { content: string; author: string; role: string }[]
  ).slice(0, WHISPER_AFTER.length);

  // 幕组可见性:wall 起点 2% 淡入(与 SceneLayer 边缘一致),
  // 贯穿 pick 保持到全片终点——选中回中的落幅即影片收势
  const opacity = useTransform(master, (m) => {
    const wallP = sceneProgress(m, "wall");
    if (wallP <= 0) return 0;
    return Math.min(1, wallP / 0.02);
  });
  const pointerEvents = useTransform(master, (m) => {
    const wallP = sceneProgress(m, "wall");
    return wallP > 0 && m < 1 ? "auto" : "none";
  });

  return (
    <motion.div
      data-scene="wall"
      style={{ opacity, pointerEvents }}
      className="absolute inset-0"
    >
      {vw > 0 && vh > 0 ? (
        <>
          {WALL_CELLS.map((cell) => (
            <WallFigure
              key={cell.id}
              cell={cell}
              vw={vw}
              vh={vh}
              plaqueTitle={wallTitles[cell.index] ?? null}
            />
          ))}
          {WHISPER_AFTER.map((afterIndex, qi) => (
            <WallWhisper
              key={afterIndex}
              afterIndex={afterIndex}
              content={quotes[qi]?.content ?? ""}
              vw={vw}
              vh={vh}
            />
          ))}
        </>
      ) : null}
      <StepTick label={tHow("steps.export.title")} />
    </motion.div>
  );
}

/**
 * 单幅展品:外层绑位移(transform x/y)与尺寸(width/height 直绑),
 * 内层绑透明度(分层铁律)。尺寸变化仅选中项在 pick 幕发生,
 * 布局成本可接受;铭牌随拉开成墙浮现,绑于无 transform 的节点。
 */
function WallFigure({
  cell,
  plaqueTitle,
  vw,
  vh,
}: {
  cell: (typeof WALL_CELLS)[number];
  plaqueTitle: string | null;
  vw: number;
  vh: number;
}) {
  const master = useMaster();
  const x = useTransform(
    master,
    (m) => figureRect(cell.index, m, vw, vh).x * vw
  );
  const y = useTransform(
    master,
    (m) => figureRect(cell.index, m, vw, vh).y * vh
  );
  const width = useTransform(
    master,
    (m) => figureRect(cell.index, m, vw, vh).w * vw
  );
  const height = useTransform(
    master,
    (m) => figureRect(cell.index, m, vw, vh).h * vh
  );
  // 非选中项随 pick 退场;选中项恒亮直到终点
  const figOpacity = useTransform(master, (m) =>
    cell.index === PICKED_INDEX ? 1 : 1 - sceneProgress(m, "pick")
  );
  // 铭牌只属于展墙形态:随拉开浮现,随选中退场
  const plaqueOpacity = useTransform(master, (m) => {
    const { spread } = wallPhases(sceneProgress(m, "wall"));
    return spread * (1 - sceneProgress(m, "pick"));
  });
  return (
    <motion.figure
      style={{ x, y, width, height }}
      className="absolute left-0 top-0 m-0"
    >
      <motion.div style={{ opacity: figOpacity }} className="h-full w-full">
        <div className="h-full w-full overflow-hidden border border-border bg-background">
          <img
            src={cell.src}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
        </div>
        <motion.figcaption
          style={{ opacity: plaqueOpacity }}
          className="absolute left-0 top-full mt-3 whitespace-nowrap font-serif text-xs tracking-wide text-muted-foreground"
        >
          <span className="mr-2">{ROMAN[cell.index] ?? ""}</span>
          {plaqueTitle}
        </motion.figcaption>
      </motion.div>
    </motion.figure>
  );
}

/**
 * 观展低语:一条用户评价化作画框缝隙里的窄栏侧注,
 * 定位于第 afterIndex 幅右侧缝隙,随推轨与横条同速左移;
 * 拉开完成后浮现,pick 幕随其余项一同退场。
 */
function WallWhisper({
  afterIndex,
  content,
  vw,
  vh,
}: {
  afterIndex: number;
  content: string;
  vw: number;
  vh: number;
}) {
  const master = useMaster();
  // 缝隙几何取自 stripPos(单一构图事实):本幅右缘到下一幅左缘
  const strip = stripPos(afterIndex, WALL_CELLS.length, vw, vh);
  const next = stripPos(afterIndex + 1, WALL_CELLS.length, vw, vh);
  const gapWidth = (next.x - strip.x - strip.w) * vw;
  const x = useTransform(master, (m) => {
    const { glide } = wallPhases(sceneProgress(m, "wall"));
    return (strip.x + strip.w - glide * (strip.trackWidth - 1)) * vw;
  });
  const opacity = useTransform(master, (m) => {
    const wallP = sceneProgress(m, "wall");
    const pickP = sceneProgress(m, "pick");
    return clamp01((wallP - SPREAD_WINDOW) / 0.1) * (1 - pickP);
  });
  return (
    <motion.div
      style={{ x, width: gapWidth }}
      className="absolute left-0 top-0 flex h-full items-center"
    >
      <motion.p
        style={{ opacity }}
        className="px-2 font-serif text-xs italic leading-relaxed text-muted-foreground"
      >
        &ldquo;{content}&rdquo;
      </motion.p>
    </motion.div>
  );
}

/** step03 章节刻度:左下角页边,随展墙浮现,pick 幕退场(HowItWorks key) */
function StepTick({ label }: { label: string }) {
  const master = useMaster();
  const opacity = useTransform(master, (m) => {
    const { spread } = wallPhases(sceneProgress(m, "wall"));
    return spread * (1 - sceneProgress(m, "pick"));
  });
  return (
    <motion.p
      style={{ opacity }}
      className="absolute bottom-10 left-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground md:left-10"
    >
      03 / {label}
    </motion.p>
  );
}
