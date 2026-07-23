"use client";

/**
 * 第四幕展墙 + 转场 C 选中回中。
 * 16 格网格拉开成横向展墙,竖滚驱动横向推轨;衬线铭牌罗马编号,
 * 用户评价化作画框缝隙间的观展低语;pick 幕选中一幅脱墙飞回视口
 * 中央成画布主角规格(与序幕 bookend 同构图),其余项淡出微散。
 * v0.9 空间纵深:每幅画作下方墨池倒影(翻转 + mask 渐隐 + 微模糊,
 * DOM 版,现为 lite/static 与熔断兜底轨)与展厅地面线,
 * 随拉开浮现、随选中退场;
 * v1.2 墨池真倒影:full 态由 GL pool pass 接管水面(展墙图集镜像
 * 重采样 + 波面扭曲 + 光标涟漪 + 焦散),DOM 镜像退场;pool 未装载
 * (图集缺失)或被熔断时 DOM 镜像恢复——双轨互备,切换点在
 * WallFigure 的 mirrorOpacity,GL 键由 PoolDirector 喂入。
 * v0.9 装裱时刻:选中项落幅时白卡纸 matte 内衬浮现 + 画框投影加深 +
 * "你的那张"落款字(Cinema.pickCaption),交付感的物质表达。
 * v1.1 形制变换(frame 幕):同一幅画重新装裱为横批/立轴/斗方,
 * 每形制停拍时右下浮现输出尺寸注——任意尺寸直至 4K 的动画表达,
 * matte 随形制同步变形;入匣下沉(archive 幕):画作缩小降至画匣口
 * 沉入(clip 匣口平面裁切,可见底缘恒等于匣口线),匣体由
 * scene-archive 接管。
 * 每格矩形 = gridPos -> stripPos -> centerSquareRect -> frameRect ->
 * archiveDrop 五段进度合成,全部为 master 的纯函数,任意滚动位置
 * 可复现(倒放成立)。
 * WHY 不套 SceneLayer:编排横跨 wall..archive 四幕,单幕层会在幕界
 * 淡出打断飞回,故本组件自管可见性(起点淡入与 SceneLayer 边缘一致)。
 * 依赖 useMaster;GL 侧接触阴影与装裱闪光由 PickAndReturnTransition 喂键。
 */
import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { cellSrc, PICKED_INDEX } from "./cinema-artworks";
import { sceneProgress } from "./cinema-config";
import {
  archiveDrop,
  centerSquareRect,
  FRAME_HOLDS,
  frameRect,
  gridPos,
  mixRect,
  stripPos,
  stripWhisperSlot,
} from "./cinema-geometry";
import { useCinema } from "./cinema-gl";
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

/** 展墙罗马编号 I-XVI:纯排版记号,不入 i18n(archive 题签共用) */
export const ROMAN = [
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

/** 观展低语栏位插在这些格序之后(Testimonials 引言取前三条) */
const WHISPER_AFTER = [3, 8, 12] as const;

/** 展墙拉开后的横条几何(含低语栏位顺延),全场景统一入口 */
function wallStrip(i: number, vw: number, vh: number) {
  return stripPos(i, 16, vw, vh, WHISPER_AFTER);
}

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
 * pick 幕内分段(v1.0 加长后):回中飞行 [0,0.6] -> 装裱 [0.62,0.78]
 * -> 分层检视 [0.78,0.95](三层错开一拍再合上) -> 落幅。
 */
function pickReturn(pickP: number): number {
  return clamp01(pickP / 0.6);
}

/**
 * 第 i 幅展品的合成矩形(视口分数):
 * 拉开(gridPos->stripPos) -> 推轨(轨道归一化左移) -> 选中回中/微散
 * -> 形制变换(frame,v1.1) -> 入匣下沉(archive,v1.1)。
 * master 单值纯函数——五段连续合成,幕界处逐位咬合(frameRect 首尾
 * 与 archiveDrop 起点均回归 centerSquareRect)。
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
  const strip = wallStrip(i, vw, vh);
  const base = mixRect(gridPos(i, vw, vh), strip, easeInOut(spread));
  const glided: ViewportRect = {
    ...base,
    x: base.x - glide * (strip.trackWidth - 1),
  };
  if (i === PICKED_INDEX) {
    const archiveP = sceneProgress(master, "archive");
    if (archiveP > 0) return archiveDrop(archiveP, vw, vh).rect;
    const frameP = sceneProgress(master, "frame");
    if (frameP > 0) return frameRect(frameP, vw, vh);
    return mixRect(
      glided,
      centerSquareRect(vw, vh),
      easeInOut(pickReturn(pickP))
    );
  }
  // 其余项随 pick 垂直微散(±3vh,方向按奇偶),与淡出叠加成让位感
  return {
    ...glided,
    y: glided.y + pickReturn(pickP) * 0.03 * (i % 2 === 0 ? -1 : 1),
  };
}

/** 选中项入匣没入比例(0-1):驱动匣口平面 clip,非选中项恒 0 */
function pickedSink(master: number, vw: number, vh: number): number {
  return archiveDrop(sceneProgress(master, "archive"), vw, vh).sink;
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
          <WallFloorLine vw={vw} vh={vh} />
          <PoolDirector vw={vw} vh={vh} />
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
              author={quotes[qi]?.author ?? ""}
              vw={vw}
              vh={vh}
            />
          ))}
          <FrameCaption />
        </>
      ) : null}
    </motion.div>
  );
}

/**
 * 墨池 GL 编排:展墙推轨进度 -> pool pass 键(水线/推轨/相位/渐显/
 * 可见门)。full 态由 GL 真倒影接管,DOM 镜像退场(见 WallFigure);
 * pool 被熔断时 DOM 镜像恢复(双轨兜底)。
 */
function PoolDirector({ vw, vh }: { vw: number; vh: number }) {
  const master = useMaster();
  const { engine, status } = useCinema();
  const feed = useCallback(
    (m: number) => {
      if (!engine || status !== "full") return;
      const wallP = sceneProgress(m, "wall");
      const { spread, glide } = wallPhases(wallP);
      const pick = pickReturn(sceneProgress(m, "pick"));
      const vis = spread * (1 - pick);
      const strip = wallStrip(0, vw, vh);
      const trackW = wallStrip(15, vw, vh).trackWidth;
      engine.setProgress(
        "poolVisible",
        vis > 0.02 && !engine.isDisabled("pool") ? 1 : 0
      );
      // 渐显与可见门分离:vis 经 poolAlpha 平滑淡入(展开期不作硬切),
      // 0.02 以下由 poolVisible 整体跳绘
      engine.setProgress("poolAlpha", vis);
      engine.setProgress("poolWaterY", strip.y + strip.h);
      engine.setProgress("poolGlide", glide);
      engine.setProgress("poolTrackW", trackW);
      engine.setProgress("poolPhase", wallP);
    },
    [engine, status, vw, vh]
  );
  useMotionValueEvent(master, "change", feed);
  // 初始喂键:刷新落在展墙中段时 change 未必触发,而 DOM 镜像已退场,
  // GL 键须同步就位(与 scene-generate 的初始喂键同理)
  useEffect(() => {
    feed(master.get());
  }, [feed, master]);
  return null;
}

/**
 * 展厅地面线:画作底缘处一条通宽发丝线——墨池水面的边界,
 * 与倒影共同给展厅一个"地面"。随拉开浮现,随选中退场。
 */
function WallFloorLine({ vw, vh }: { vw: number; vh: number }) {
  const master = useMaster();
  const strip = wallStrip(0, vw, vh);
  const opacity = useTransform(master, (m) => {
    const { spread } = wallPhases(sceneProgress(m, "wall"));
    return spread * (1 - pickReturn(sceneProgress(m, "pick"))) * 0.8;
  });
  return (
    <motion.div
      aria-hidden="true"
      style={{ opacity, top: (strip.y + strip.h) * vh + 1 }}
      className="pointer-events-none absolute inset-x-0 h-px bg-border"
    />
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
  const { engine, status, breakerVersion } = useCinema();
  // 熔断状态变化经 context 触发重渲染,mirrorOpacity 重算——
  // DOM 镜像随熔断恢复/退场(useTransform 闭包在重渲染时重订阅)
  void breakerVersion;
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
  // 非选中项随回中段退场;选中项恒亮直到终点
  const figOpacity = useTransform(master, (m) =>
    cell.index === PICKED_INDEX ? 1 : 1 - pickReturn(sceneProgress(m, "pick"))
  );
  // 铭牌只属于展墙形态:随拉开浮现,随选中退场
  const plaqueOpacity = useTransform(master, (m) => {
    const { spread } = wallPhases(sceneProgress(m, "wall"));
    return spread * (1 - pickReturn(sceneProgress(m, "pick")));
  });
  // 墨池倒影(v1.2 双轨):与铭牌同生命周期(展墙形态专属);
  // full 且 pool 在役时 GL 真水面接管,DOM 镜像退场(返回 0),
  // lite/static、pool 未装载(图集缺失)或被熔断时 DOM 假倒影兜底。
  // hasPass 迟于装载完成才为真,交接前的空窗由 DOM 镜像覆盖
  const mirrorOpacity = useTransform(master, (m) => {
    if (
      status === "full" &&
      engine?.hasPass("pool") &&
      !engine.isDisabled("pool")
    ) {
      return 0;
    }
    const { spread } = wallPhases(sceneProgress(m, "wall"));
    return spread * (1 - pickReturn(sceneProgress(m, "pick")));
  });
  // 入匣裁切(仅选中项,v1.1):匣口平面吃掉画作没入部分——
  // 可见底缘恒等于匣口线(几何联动见 archiveDrop);sink=0 时撤为
  // none,避免 clip 参考盒裁掉盒外的 matte 内衬
  const clipPath = useTransform(master, (m) => {
    if (cell.index !== PICKED_INDEX) return "none";
    const sink = pickedSink(m, vw, vh);
    return sink > 0.001 ? `inset(0 0 ${(sink * 100).toFixed(2)}% 0)` : "none";
  });
  return (
    <motion.figure
      style={{ x, y, width, height, clipPath }}
      className="absolute left-0 top-0 m-0"
    >
      <motion.div style={{ opacity: figOpacity }} className="h-full w-full">
        {cell.index === PICKED_INDEX ? <FramingReveal /> : null}
        {cell.index === PICKED_INDEX ? <FrameSizeNotes /> : null}
        <div className="h-full w-full overflow-hidden border border-border bg-background">
          <img
            src={cell.src}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
        </div>
        {cell.index === PICKED_INDEX ? <LayersInspect src={cell.src} /> : null}
        {/* 墨池倒影 DOM 兜底轨:画作映在墨面上,mask 向下渐隐 + 微模糊
            (水面漫反射);full 态 pool 在役时 opacity 恒 0 让位 GL 真倒影 */}
        <motion.div
          aria-hidden="true"
          style={{ opacity: mirrorOpacity }}
          className="pointer-events-none absolute left-0 top-full mt-0.5 h-[42%] w-full overflow-hidden"
        >
          <img
            src={cell.src}
            alt=""
            className="w-full -scale-y-100 blur-[2px] [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.34),transparent_78%)]"
          />
        </motion.div>
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
 * 装裱时刻(仅选中项):回中完成后白卡纸 matte 内衬在画外一圈浮现,
 * 画框投影同步加深,下方落一行"你的那张"——交付的物质证词。
 * matte 置于画作 DOM 之前且负 z,只露出四边;全部量为 pick 纯函数。
 */
function FramingReveal() {
  const t = useTranslations("Cinema");
  const master = useMaster();
  // matte 贯穿 pick 落幅与 frame 形制变换(装裱随形制同变),
  // archive 早段淡出——内衬不入匣,也为 clip 挂载让出无残影窗口
  const reveal = useTransform(master, (m) => {
    const rise = easeInOut(clamp01((sceneProgress(m, "pick") - 0.62) / 0.16));
    return rise * (1 - clamp01(sceneProgress(m, "archive") / 0.12));
  });
  const shadow = useTransform(
    reveal,
    (v) => `0 ${18 * v}px ${56 * v}px rgba(24, 20, 15, ${0.2 * v})`
  );
  // "你的那张"只属于 pick 落幅一拍,形制变换开始即让位尺寸注
  const captionOpacity = useTransform(master, (m) => {
    const rise = easeInOut(clamp01((sceneProgress(m, "pick") - 0.62) / 0.16));
    return rise * (1 - clamp01(sceneProgress(m, "frame") / 0.06));
  });
  return (
    <>
      <motion.div
        aria-hidden="true"
        style={{ opacity: reveal, boxShadow: shadow }}
        className="pointer-events-none absolute -inset-4 -z-10 border border-border/60 bg-[#faf8f3]"
      />
      <motion.p
        style={{ opacity: captionOpacity }}
        className="pointer-events-none absolute left-1/2 top-full mt-7 -translate-x-1/2 whitespace-nowrap text-center font-serif text-sm italic text-muted-foreground"
      >
        {t("pickCaption")}
      </motion.p>
    </>
  );
}

/** 形制变换的三段尺寸注文案:纯数字排版记号,不入 i18n */
const FRAME_SIZE_LABELS = [
  "3840 × 2160",
  "2160 × 3840",
  "4096 × 4096",
] as const;

/**
 * 尺寸注(仅选中项,v1.1):每个形制停拍窗内,画框右下角外浮现
 * 输出尺寸——"任意尺寸直至 4K"的证词;随 figure 变形同步移动。
 */
function FrameSizeNotes() {
  return (
    <>
      {FRAME_HOLDS.map((hold, i) => (
        <FrameSizeNote
          key={FRAME_SIZE_LABELS[i] ?? String(i)}
          hold={hold}
          label={FRAME_SIZE_LABELS[i] ?? ""}
        />
      ))}
    </>
  );
}

function FrameSizeNote({
  hold,
  label,
}: {
  hold: { start: number; end: number };
  label: string;
}) {
  const master = useMaster();
  const opacity = useTransform(master, (m) => {
    const p = sceneProgress(m, "frame");
    return Math.min(
      clamp01((p - hold.start) / 0.05),
      1 - clamp01((p - hold.end) / 0.05)
    );
  });
  return (
    <motion.p
      style={{ opacity }}
      className="pointer-events-none absolute right-0 top-full mt-3 whitespace-nowrap font-mono text-[11px] uppercase tracking-widest text-muted-foreground"
    >
      {label}
    </motion.p>
  );
}

/**
 * 形制署名(视口级,v1.1):frame 幕全程底部一句
 * "任意尺寸,直至 4K"(Cinema.frameCaption)——特点用动画演,
 * 文字只署名;首末让位相邻幕的落款。
 */
function FrameCaption() {
  const t = useTranslations("Cinema");
  const master = useMaster();
  const opacity = useTransform(master, (m) => {
    const p = sceneProgress(m, "frame");
    if (p <= 0) return 0;
    return Math.min(clamp01((p - 0.1) / 0.08), 1 - clamp01((p - 0.9) / 0.08));
  });
  return (
    <motion.p
      style={{ opacity }}
      className="pointer-events-none absolute bottom-[9vh] left-1/2 -translate-x-1/2 whitespace-nowrap text-center font-serif text-sm italic text-muted-foreground"
    >
      {t("frameCaption")}
    </motion.p>
  );
}

/**
 * 分层检视(仅选中项,v1.0):装裱后画作短暂分离为三片错开的层——
 * 纸底层/墨画层/印章层(印层为右下角裁切),彼此微位移微旋、层间
 * 投影,一拍后合回原位;随后"PNG · WebP · PSD 分层"署名浮现。
 * 交付格式的动画表达:分层是看得见的,不是列表里的一行字。
 * 三层叠于原图之上,分离量为 pick 纯函数钟形(合上后完全透明,
 * 原图恢复唯一真相)。
 */
function LayersInspect({ src }: { src: string }) {
  const t = useTranslations("Cinema");
  const master = useMaster();
  // 分离量:0.78-0.95 窗口内钟形(错开一拍再合上)
  const split = useTransform(master, (m) => {
    const p = sceneProgress(m, "pick");
    const w = clamp01((p - 0.78) / 0.17);
    return Math.sin(Math.min(1, w) * Math.PI);
  });
  const visibility = useTransform(split, (v) => (v > 0.001 ? 1 : 0));
  const paperX = useTransform(split, (v) => v * -14);
  const paperY = useTransform(split, (v) => v * 10);
  const paperRotate = useTransform(split, (v) => v * -1.2);
  const inkX = useTransform(split, (v) => v * 4);
  const inkY = useTransform(split, (v) => v * -6);
  const sealX = useTransform(split, (v) => v * 18);
  const sealY = useTransform(split, (v) => v * -14);
  const sealRotate = useTransform(split, (v) => v * 1.4);
  const layerShadow = useTransform(
    split,
    (v) => `0 ${8 * v}px ${22 * v}px rgba(24, 20, 15, ${0.16 * v})`
  );
  // 署名与分层同窗浮现,pick 落幅保持(交割单),形制变换起让位尺寸注
  const captionOpacity = useTransform(master, (m) => {
    const rise = clamp01((sceneProgress(m, "pick") - 0.8) / 0.12);
    return rise * (1 - clamp01(sceneProgress(m, "frame") / 0.06));
  });
  return (
    <>
      <motion.div
        aria-hidden="true"
        style={{ opacity: visibility }}
        className="pointer-events-none absolute inset-0"
      >
        {/* 纸底层:空白宣纸 */}
        <motion.div
          style={{
            x: paperX,
            y: paperY,
            rotate: paperRotate,
            boxShadow: layerShadow,
          }}
          className="absolute inset-0 border border-border/60 bg-[#f5f2ea]"
        />
        {/* 墨画层:画作本体 */}
        <motion.div
          style={{ x: inkX, y: inkY, boxShadow: layerShadow }}
          className="absolute inset-0 overflow-hidden border border-border/60 bg-[#f5f2ea]"
        >
          <img
            src={src}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
        </motion.div>
        {/* 印章层:右下角局部裁切(印是独立的一层) */}
        <motion.div
          style={{
            x: sealX,
            y: sealY,
            rotate: sealRotate,
            boxShadow: layerShadow,
          }}
          className="absolute bottom-[6%] right-[6%] h-[16%] w-[16%] overflow-hidden border border-border/50 bg-[#f5f2ea]"
        >
          <img
            src={src}
            alt=""
            aria-hidden="true"
            className="absolute h-[625%] w-[625%] max-w-none object-cover"
            style={{ right: "-37.5%", bottom: "-37.5%" }}
          />
        </motion.div>
      </motion.div>
      <motion.p
        style={{ opacity: captionOpacity }}
        className="pointer-events-none absolute left-1/2 top-full mt-14 -translate-x-1/2 whitespace-nowrap text-center font-mono text-[11px] uppercase tracking-widest text-muted-foreground/80"
      >
        {t("layersCaption")}
      </motion.p>
    </>
  );
}

/**
 * 观展低语:一条用户评价占据轨道上的专属栏位(stripWhisperSlot),
 * 随推轨与横条同速左移——它是展线上的一站,不是塞进画缝的注脚。
 * 拉开完成后浮现,pick 幕随其余项一同退场;引言下附作者署名。
 */
function WallWhisper({
  afterIndex,
  content,
  author,
  vw,
  vh,
}: {
  afterIndex: number;
  content: string;
  author: string;
  vw: number;
  vh: number;
}) {
  const master = useMaster();
  // 栏位几何取自 stripWhisperSlot(单一构图事实),与横条同 trackWidth
  const slot = stripWhisperSlot(
    afterIndex,
    WALL_CELLS.length,
    vw,
    vh,
    WHISPER_AFTER
  );
  const x = useTransform(master, (m) => {
    const { glide } = wallPhases(sceneProgress(m, "wall"));
    return (slot.x - glide * (slot.trackWidth - 1)) * vw;
  });
  const opacity = useTransform(master, (m) => {
    const wallP = sceneProgress(m, "wall");
    const pickP = sceneProgress(m, "pick");
    return clamp01((wallP - SPREAD_WINDOW) / 0.1) * (1 - pickReturn(pickP));
  });
  return (
    <motion.div
      style={{ x, width: slot.w * vw, top: slot.y * vh, height: slot.h * vh }}
      className="absolute left-0 flex items-center"
    >
      <motion.figure style={{ opacity }} className="m-0 px-4 text-center">
        <blockquote className="font-serif text-sm italic leading-relaxed text-muted-foreground">
          &ldquo;{content}&rdquo;
        </blockquote>
        <figcaption className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
          {author}
        </figcaption>
      </motion.figure>
    </motion.div>
  );
}
