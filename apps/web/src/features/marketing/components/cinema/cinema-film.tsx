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
import { useTranslations } from "next-intl";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { CinemaGLProvider, useCinema } from "./cinema-gl";
import { CinemaStage, SceneLayer } from "./cinema-stage";
import type { CinemaEngine } from "./gl/engine";
import { createDenoisePass } from "./gl/passes/denoise";
import { createDollyPass } from "./gl/passes/dolly";
import { createFluidPass } from "./gl/passes/fluid";
import { createParticlesPass } from "./gl/passes/particles";
import { renderTextTexture } from "./gl/text-texture";
import { GenerateScene } from "./scene-generate";
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
 * GL pass 一次性装载:样张/深度图解码与标题纹理就绪后按绘制序注册
 * (denoise 画布 -> dolly -> fluid -> particles -> 标题 denoise;
 * post 已由 provider 先行注册,终幕实例由 FinaleStage 自行注册)。
 * 个别资产失败仅跳过对应 pass,其余演出不受影响;
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
    const artwork = new Image();
    artwork.src = "/cinema/artwork-hero.webp";
    const depth = new Image();
    depth.src = "/cinema/artwork-hero-depth.webp";
    const artworkReady = artwork
      .decode()
      .then(() => artwork)
      .catch(() => null);
    const depthReady = depth
      .decode()
      .then(() => depth)
      .catch(() => null);
    const titleReady = renderTextTexture(titleText, {
      fontPx: 96,
      width: 1536,
      height: 512,
      color: "#1a1a1a",
    }).catch(() => null);
    Promise.all([artworkReady, depthReady, titleReady]).then(
      ([art, dep, title]) => {
        if (disposed) return;
        if (art) engine.addPass(createDenoisePass(art));
        if (art && dep) engine.addPass(createDollyPass(art, dep));
        // 浮点色缓冲不可用时工厂返回 null,反转由 dolly 压暗与墨章底色兜底
        const fluid = createFluidPass();
        if (fluid) engine.addPass(fluid);
        // 样张缺失时 morph 粒子退化为墨点,序幕墨溅(纯墨色)不受影响
        engine.addPass(createParticlesPass(art));
        if (title) {
          engine.addPass(createDenoisePass(title, TITLE_KEYS, true));
        }
      }
    );
    return () => {
      disposed = true;
    };
  }, [engine, titleText]);
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
        <SceneLayer scene="generate">
          <GenerateScene />
        </SceneLayer>
        <SceneLayer scene="manifesto">
          <ManifestoScene />
        </SceneLayer>
        <SceneLayer scene="multiply">
          <MultiplyScene />
        </SceneLayer>
        {/* 展墙横跨 wall 与 pick 两幕,自管可见性,不套 SceneLayer */}
        <WallScene />
        <ZoomThroughTransition />
        <MultiplyTransition />
        <PickAndReturnTransition />
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
