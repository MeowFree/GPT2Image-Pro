/**
 * cinema 联调预览页:滚动区 + GL 摄影棚。
 * 仅开发联调用,首页集成完成后随 Task 14 删除。
 */
import { CinemaGLProvider } from "@/features/marketing/components/cinema/cinema-gl";

export default function CinemaDemoPage() {
  return (
    <CinemaGLProvider>
      <main className="min-h-[400vh] bg-background">
        <div className="sticky top-0 flex h-screen items-center justify-center">
          <p className="font-serif text-2xl">cinema GL demo</p>
        </div>
      </main>
    </CinemaGLProvider>
  );
}
