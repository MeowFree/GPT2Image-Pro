"use client";

/**
 * cinema 联调预览页:CinemaStage 主舞台 + 各幕层 + GL pass 挂载。
 * 仅开发联调用,首页集成完成后随 Task 14 删除。
 */
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
import { GenerateScene } from "@/features/marketing/components/cinema/scene-generate";

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

export default function CinemaDemoPage() {
  return (
    <CinemaGLProvider>
      <DenoisePassMount />
      <main className="bg-background">
        <CinemaStage>
          <SceneLayer scene="opening">
            <div className="flex h-full items-center justify-center">
              <p className="font-serif text-4xl">opening</p>
            </div>
          </SceneLayer>
          <SceneLayer scene="generate">
            <GenerateScene />
          </SceneLayer>
        </CinemaStage>
      </main>
    </CinemaGLProvider>
  );
}
