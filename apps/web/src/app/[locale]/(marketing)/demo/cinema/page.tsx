"use client";

/**
 * cinema 联调预览页:CinemaStage 主舞台 + 各幕层 + GL pass 挂载。
 * 仅开发联调用,首页集成完成后随 Task 14 删除。
 */
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import {
  CinemaGLProvider,
  useCinema,
} from "@/features/marketing/components/cinema/cinema-gl";
import {
  CinemaStage,
  SceneLayer,
} from "@/features/marketing/components/cinema/cinema-stage";
import { createDenoisePass } from "@/features/marketing/components/cinema/gl/passes/denoise";
import { createDollyPass } from "@/features/marketing/components/cinema/gl/passes/dolly";
import { createFluidPass } from "@/features/marketing/components/cinema/gl/passes/fluid";
import { createParticlesPass } from "@/features/marketing/components/cinema/gl/passes/particles";
import { renderTextTexture } from "@/features/marketing/components/cinema/gl/text-texture";
import { GenerateScene } from "@/features/marketing/components/cinema/scene-generate";
import { ManifestoScene } from "@/features/marketing/components/cinema/scene-manifesto";
import { MultiplyScene } from "@/features/marketing/components/cinema/scene-multiply";
import { OpeningScene } from "@/features/marketing/components/cinema/scene-opening";
import { WallScene } from "@/features/marketing/components/cinema/scene-wall";
import {
  MultiplyTransition,
  PickAndReturnTransition,
  ZoomThroughTransition,
} from "@/features/marketing/components/cinema/transitions";

/** 挂载处(client effect):样张解码完成后注册去噪显影 pass,与后续首页相同写法 */
function DenoisePassMount() {
  const { engine } = useCinema();
  useEffect(() => {
    if (!engine) return;
    const img = new Image();
    img.src = "/cinema/artwork-hero.webp";
    let disposed = false;
    img.decode().then(() => {
      if (!disposed) engine.addPass(createDenoisePass(img));
    });
    return () => {
      disposed = true;
    };
  }, [engine]);
  return null;
}

/**
 * 推轨与流体 pass 挂载:双图解码完成后先注册推轨、再注册流体——
 * pass 按注册序绘制,墨的涡卷必须合成于推轨画面之上。
 * createFluidPass 在 EXT_color_buffer_float 缺失时返回 null(跳过),
 * 反转由 dolly 末端压暗与宣言章 DOM 底色兜底。
 */
function DollyPassMount() {
  const { engine } = useCinema();
  useEffect(() => {
    if (!engine) return;
    const img = new Image();
    img.src = "/cinema/artwork-hero.webp";
    const depth = new Image();
    depth.src = "/cinema/artwork-hero-depth.webp";
    let disposed = false;
    Promise.all([img.decode(), depth.decode()]).then(() => {
      if (disposed) return;
      engine.addPass(createDollyPass(img, depth));
      const fluid = createFluidPass();
      if (fluid) engine.addPass(fluid);
    });
    return () => {
      disposed = true;
    };
  }, [engine]);
  return null;
}

/**
 * 粒子 pass 挂载:样张解码后注册——增殖转场的 morph 模式在顶点阶段
 * 采样该纹理取色(图像炸裂为粒子云);解码失败退回无纹理注册,
 * 序幕墨溅(纯墨色)不受影响,morph 粒子表现为墨点。
 */
function ParticlesPassMount() {
  const { engine } = useCinema();
  useEffect(() => {
    if (!engine) return;
    const img = new Image();
    img.src = "/cinema/artwork-hero.webp";
    let disposed = false;
    img
      .decode()
      .then(() => {
        if (!disposed) engine.addPass(createParticlesPass(img));
      })
      .catch(() => {
        if (!disposed) engine.addPass(createParticlesPass(null));
      });
    return () => {
      disposed = true;
    };
  }, [engine]);
  return null;
}

/** 标题显影 pass 挂载:字体就绪后把衬线标题渲为纹理注册(textMode) */
function TitlePassMount() {
  const { engine } = useCinema();
  const t = useTranslations("Hero");
  // 换行与 DOM 标题的两行结构对应(title1 换行 titleHighlight)
  const titleText = `${t("title1")}\n${t("titleHighlight")}`;
  useEffect(() => {
    if (!engine) return;
    let disposed = false;
    renderTextTexture(titleText, {
      fontPx: 96,
      width: 1536,
      height: 512,
      color: "#1a1a1a",
    }).then((canvas) => {
      if (!disposed) {
        engine.addPass(
          createDenoisePass(
            canvas,
            {
              rect: "titleRect",
              p: "titleP",
              glow: "titleGlow",
              visible: "titleVisible",
            },
            true
          )
        );
      }
    });
    return () => {
      disposed = true;
    };
  }, [engine, titleText]);
  return null;
}

export default function CinemaDemoPage() {
  return (
    <CinemaGLProvider>
      <DenoisePassMount />
      <DollyPassMount />
      <ParticlesPassMount />
      <TitlePassMount />
      <main className="bg-background">
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
      </main>
    </CinemaGLProvider>
  );
}
