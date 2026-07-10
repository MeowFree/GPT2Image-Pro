/**
 * cinema 联调预览页:CinemaStage 主舞台 + 占位幕层。
 * 仅开发联调用,首页集成完成后随 Task 14 删除。
 */
import { CinemaGLProvider } from "@/features/marketing/components/cinema/cinema-gl";
import {
  CinemaStage,
  SceneLayer,
} from "@/features/marketing/components/cinema/cinema-stage";

export default function CinemaDemoPage() {
  return (
    <CinemaGLProvider>
      <main className="bg-background">
        <CinemaStage>
          <SceneLayer scene="opening">
            <div className="flex h-full items-center justify-center">
              <p className="font-serif text-4xl">opening</p>
            </div>
          </SceneLayer>
          <SceneLayer scene="generate">
            <div className="flex h-full items-center justify-center">
              <p className="font-serif text-4xl">generate</p>
            </div>
          </SceneLayer>
        </CinemaStage>
      </main>
    </CinemaGLProvider>
  );
}
