"use client";

/**
 * GL 摄影棚挂载层:固定全屏画布 + 引擎生命周期 + 状态探测阶梯。
 * full 为 WebGL2 全效;lite 为 GL 不可用或降档后的 DOM 管线;
 * static 为减动效或窄屏。画布 pointer-events-none;takeover 时
 * 提升 z 盖过正文(仅钉住转场窗口内,窗口中无可交互内容)。
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CinemaEngine } from "./gl/engine";
import { createPostPass } from "./gl/passes/post";

export type GLStatus = "full" | "lite" | "static";

/**
 * SSR 安全的 layout effect:初始探测必须在首帧 paint 之前收敛
 * (useEffect 在 paint 后跑,会让用户看到一帧静态排版再突变为影片
 * ——用户实证的"进入瞬间旧 UI 闪切");服务端无 DOM 用 useEffect
 * 兜底以避 SSR 警告(服务端本就不执行)。
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface CinemaContextValue {
  status: GLStatus;
  /** 初始探测是否已完成:no-flash 占位标记的移除时机 */
  probed: boolean;
  engine: CinemaEngine | null;
  setTakeover: (on: boolean) => void;
}

const CinemaContext = createContext<CinemaContextValue>({
  status: "static",
  probed: false,
  engine: null,
  setTakeover: () => {},
});

export function useCinema(): CinemaContextValue {
  return useContext(CinemaContext);
}

/** 初始探测:减动效/窄屏直接 static,不建上下文 */
function probeInitialStatus(): GLStatus {
  if (typeof window === "undefined") return "static";
  // dev 专用强制降级参数(?gl=lite|static):三层回退走查用,生产不读取
  if (process.env.NODE_ENV !== "production") {
    const forced = new URLSearchParams(window.location.search).get("gl");
    if (forced === "lite" || forced === "static") return forced;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "static";
  }
  if (window.innerWidth < 768) return "static";
  return "full";
}

export function CinemaGLProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [engine, setEngine] = useState<CinemaEngine | null>(null);
  const [status, setStatus] = useState<GLStatus>("static");
  const [probed, setProbed] = useState(false);
  const [takeover, setTakeover] = useState(false);

  // 先探测决定是否渲染 canvas,再在 canvas 就绪后建引擎(两段 effect)。
  // WHY layout effect:探测在 hydration 后、首帧 paint 前同步收敛,
  // 用户不会看到"静态排版一帧 -> 影片"的突变;并落 cinemaReady 信号,
  // 通知布局里的内联 no-flash 脚本无须撤销占位隐藏(其 4s 兜底仅在
  // bundle 加载失败时露出静态真相)。
  useIsomorphicLayoutEffect(() => {
    setStatus(probeInitialStatus());
    setProbed(true);
    document.documentElement.dataset.cinemaReady = "1";
  }, []);

  useEffect(() => {
    if (!probed || status !== "full" || !canvasRef.current) return;
    const created = CinemaEngine.create(canvasRef.current);
    if (!created) {
      setStatus("lite");
      return;
    }
    created.addPass(createPostPass());
    created.resize();
    const onResize = () => created.resize();
    window.addEventListener("resize", onResize);
    setEngine(created);
    // 运行中降档:governor 到 0 则退出 GL 走 lite
    const watchdog = window.setInterval(() => {
      if (created.governor.tier === 0) {
        window.clearInterval(watchdog);
        window.removeEventListener("resize", onResize);
        created.dispose();
        setEngine(null);
        setStatus("lite");
      }
    }, 2000);
    return () => {
      window.clearInterval(watchdog);
      window.removeEventListener("resize", onResize);
      created.dispose();
      setEngine(null);
    };
  }, [probed, status]);

  return (
    <CinemaContext.Provider value={{ status, probed, engine, setTakeover }}>
      {status === "full" ? (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          tabIndex={-1}
          data-takeover={takeover ? "true" : "false"}
          className="pointer-events-none fixed inset-0 h-full w-full data-[takeover=false]:z-[1] data-[takeover=true]:z-40"
        />
      ) : null}
      {children}
    </CinemaContext.Provider>
  );
}
