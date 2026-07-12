"use client";

/**
 * 影片装配层:CinemaGLProvider + 探测分流 + GL pass 一次性装载 + 引擎
 * 唤醒观察。status=static 渲染 StaticFilm(编辑部静态排版,内容真相);
 * full/lite 渲染 CinemaStage 七幕与三转场(lite 由各幕按 status 自降级)。
 * children 在 provider 内、主影片之后渲染:谷段常规流(SLA/Pricing/FAQ)
 * 与 FinaleStage 经此传入,终幕才能经 context 取到同一引擎——
 * 单画布单引擎不变式得以保持。本文件整体为 client 模块,
 * 页面侧直接静态 import 即可(Next 16 惯例)。
 */
import { useMotionValueEvent } from "framer-motion";
import { useTranslations } from "next-intl";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { ChapterRail } from "./chapter-rail";
import { darkWindow } from "./cinema-config";
import { CinemaGLProvider, useCinema } from "./cinema-gl";
import {
  CinemaStage,
  SceneLayer,
  useMaster,
  useSceneProgress,
} from "./cinema-stage";
import type { CinemaEngine } from "./gl/engine";
import { createDenoisePass } from "./gl/passes/denoise";
import { createDollyPass } from "./gl/passes/dolly";
import { createFluidPass } from "./gl/passes/fluid";
import { createParticlesPass } from "./gl/passes/particles";
import { renderTextTexture } from "./gl/text-texture";
import { GenerateScene, ReviseMarkLayer } from "./scene-generate";
import { InvokeScene } from "./scene-invoke";
import { ManifestoScene } from "./scene-manifesto";
import { MultiplyScene } from "./scene-multiply";
import { OpeningScene } from "./scene-opening";
import { WallScene } from "./scene-wall";
import { StaticFilm } from "./static-film";
import {
  MultiplyTransition,
  PickAndReturnTransition,
  ZoomThroughTransition,
} from "./transitions";

/** 引擎唤醒计数:同一引擎可被多个根元素观察,任一可见即保持活跃 */
const wakeCounts = new WeakMap<CinemaEngine, number>();

/**
 * 观察 ref 根元素进出视口并联动 engine.setActive:
 * 主影片与终幕各自注册,全部离场(静默谷)时引擎休眠——不出帧不排队。
 * 首次回报即同步一次 setActive,页面刷新落在谷段时也能立即休眠。
 */
export function useEngineWake(ref: RefObject<HTMLElement | null>): void {
  const { engine } = useCinema();
  useEffect(() => {
    const el = ref.current;
    if (!engine || !el) return;
    let visible = false;
    const io = new IntersectionObserver((entries) => {
      const next = entries.some((entry) => entry.isIntersecting);
      if (next !== visible) {
        visible = next;
        wakeCounts.set(engine, (wakeCounts.get(engine) ?? 0) + (next ? 1 : -1));
      }
      engine.setActive((wakeCounts.get(engine) ?? 0) > 0);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (visible) {
        const rest = (wakeCounts.get(engine) ?? 0) - 1;
        wakeCounts.set(engine, rest);
        engine.setActive(rest > 0);
      }
    };
  }, [engine, ref]);
}

/** 标题显影实例读键(与 OpeningScene 喂键侧一致) */
const TITLE_KEYS = {
  rect: "titleRect",
  p: "titleP",
  glow: "titleGlow",
  visible: "titleVisible",
} as const;

/**
 * revise 定稿覆盖实例读键:矩形与画布实例共用(同一 figure),
 * 进度/可见门独立(GenerateScene 喂)。
 */
const REVISE_KEYS = {
  rect: "canvasRect",
  p: "reviseP",
  glow: "reviseGlow",
  visible: "reviseVisible",
} as const;

/** 朱笔圈心(图幅分数,起笔浓墨区)与径向生长强度——revise 幕常量 */
export const REVISE_CENTER = [0.3, 0.45] as const;
const REVISE_BIAS_STRENGTH = 0.7;

/**
 * GL pass 一次性装载:样张(定稿/初稿)/深度图解码与标题纹理就绪后按
 * 绘制序注册(初稿 denoise -> 定稿 revise overlay -> dolly -> fluid ->
 * particles -> 标题 denoise;post 已由 provider 先行注册,终幕实例由
 * FinaleStage 自行注册)。个别资产失败仅跳过对应 pass,其余演出不受
 * 影响(初稿缺失时降级用定稿,revise 幕退化为无覆盖变化);
 * 卸载由 provider dispose 兜底。
 */
function FilmPasses() {
  const { engine } = useCinema();
  const t = useTranslations("Hero");
  // 换行与 DOM 标题两行结构对应(title1 换行 titleHighlight)
  const titleText = `${t("title1")}\n${t("titleHighlight")}`;
  useEffect(() => {
    if (!engine) return;
    let disposed = false;
    const loadImage = (src: string) => {
      const img = new Image();
      img.src = src;
      return img
        .decode()
        .then(() => img)
        .catch(() => null);
    };
    const artworkReady = loadImage("/cinema/artwork-hero.webp");
    const draftReady = loadImage("/cinema/artwork-hero-draft.webp");
    const depthReady = loadImage("/cinema/artwork-hero-depth.webp");
    const titleReady = renderTextTexture(titleText, {
      fontPx: 96,
      width: 1536,
      height: 512,
      color: "#1a1a1a",
    }).catch(() => null);
    Promise.all([artworkReady, draftReady, depthReady, titleReady]).then(
      ([art, draft, dep, title]) => {
        if (disposed) return;
        // 画布显影画初稿(generate/macro 幕的对象);revise overlay 画
        // 定稿,从朱笔圈心生长覆盖;dive 及以后全部沿用定稿
        const draftOrFinal = draft ?? art;
        if (draftOrFinal) engine.addPass(createDenoisePass(draftOrFinal));
        if (art) {
          engine.addPass(
            createDenoisePass(art, REVISE_KEYS, {
              mode: "overlay",
              centerBias: [
                REVISE_CENTER[0],
                REVISE_CENTER[1],
                REVISE_BIAS_STRENGTH,
              ],
            })
          );
        }
        if (art && dep) engine.addPass(createDollyPass(art, dep));
        // 浮点色缓冲不可用时工厂返回 null,反转由 dolly 压暗与墨章底色兜底
        const fluid = createFluidPass();
        if (fluid) engine.addPass(fluid);
        // 样张缺失时 morph 粒子退化为墨点,序幕墨溅(纯墨色)不受影响
        engine.addPass(createParticlesPass(art));
        if (title) {
          engine.addPass(createDenoisePass(title, TITLE_KEYS, { mode: "text" }));
        }
      }
    );
    return () => {
      disposed = true;
    };
  }, [engine, titleText]);
  return null;
}

/** [0,1] 线性窗口段 */
function seg01(p: number, a: number, b: number): number {
  return Math.max(0, Math.min(1, (p - a) / (b - a)));
}

/**
 * 活墨编排:序幕淡墨云的显示强度与向心聚拢,跨 opening/generate 两幕
 * 单点决策(fluid pass 的 inkFade/inkGather 单一事实源;inkP 生命进度
 * 由 OpeningScene 喂——它属于序幕自身的时间轴)。
 * fade 是叙事包络而非开关:滴落初洇较显(0.55),标题显影期退成底衬
 * (0.26,字从墨里显出来、墨不压字),打字聚拢段转浓活跃(0.75,
 * 墨流被吸向画布),显影开始被画布吸尽(generate 前 28% 归零)。
 */
function InkMistDirector() {
  const opening = useSceneProgress("opening");
  const generate = useSceneProgress("generate");
  const { engine } = useCinema();
  const feed = (o: number, g: number) => {
    const drop = seg01(o, 0.02, 0.1) * 0.55;
    const recede = seg01(o, 0.12, 0.24) * (0.26 - 0.55);
    const rise = seg01(o, 0.55, 0.9) * (0.75 - 0.26);
    const envelope = drop + recede + rise;
    const fade = envelope * (1 - seg01(g, 0.02, 0.28));
    engine?.setProgress("inkFade", fade);
    const gather = Math.min(seg01(o, 0.6, 0.92), 1 - seg01(g, 0, 0.3));
    engine?.setProgress("inkGather", gather);
  };
  useMotionValueEvent(opening, "change", (v) => feed(v, generate.get()));
  useMotionValueEvent(generate, "change", (v) => feed(opening.get(), v));
  return null;
}

/**
 * 暗场页头联动:穿越压暗起点到增殖回纸点之间,站点页头随影片入暗退场
 * (body[data-cinema-dark],CSS 在 globals 定义)。卸载时清除属性,
 * 避免离开页面后页头保持隐藏。
 */
function HeaderDimmer() {
  const master = useMaster();
  useMotionValueEvent(master, "change", (m) => {
    const { start, end } = darkWindow();
    document.body.toggleAttribute("data-cinema-dark", m >= start && m < end);
  });
  useEffect(() => () => document.body.removeAttribute("data-cinema-dark"), []);
  return null;
}

/** 探测分流:static 走静态编排,其余走单时间轴主舞台(七幕 + 三转场) */
function FilmBody() {
  const { status } = useCinema();
  const filmRef = useRef<HTMLDivElement | null>(null);
  useEngineWake(filmRef);
  if (status === "static") return <StaticFilm />;
  return (
    <div ref={filmRef}>
      <CinemaStage>
        <SceneLayer scene="opening" holdAtStart>
          <OpeningScene />
        </SceneLayer>
        {/* 显影横跨 generate 与 macro 两幕(连续镜头),自管可见性 */}
        <GenerateScene />
        <SceneLayer scene="manifesto">
          <ManifestoScene />
        </SceneLayer>
        {/* 一行调用:宣言(理念)与增殖(结果)之间的手段,墨底延续 */}
        <SceneLayer scene="invoke">
          <InvokeScene />
        </SceneLayer>
        <SceneLayer scene="multiply">
          <MultiplyScene />
        </SceneLayer>
        {/* 展墙横跨 wall 与 pick 两幕,自管可见性,不套 SceneLayer */}
        <WallScene />
        <ZoomThroughTransition />
        <MultiplyTransition />
        <PickAndReturnTransition />
        {/* 章节导轨/页头暗场/活墨/朱笔圈:全片常驻编排件 */}
        <ChapterRail />
        <HeaderDimmer />
        <InkMistDirector />
        <ReviseMarkLayer />
      </CinemaStage>
    </div>
  );
}

/**
 * 影片入口:provider + pass 装载 + 主影片,children 为影片之后的
 * 页面区块(谷段与终幕),与影片共享同一 GL 上下文与探测结果。
 */
export function CinemaFilm({ children }: { children?: ReactNode }) {
  return (
    <CinemaGLProvider>
      <FilmPasses />
      <FilmBody />
      {children}
    </CinemaGLProvider>
  );
}
