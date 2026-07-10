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
  useRef,
  useState,
} from "react";
import { CinemaEngine } from "./gl/engine";
import { createPostPass } from "./gl/passes/post";

export type GLStatus = "full" | "lite" | "static";

interface CinemaContextValue {
  status: GLStatus;
  engine: CinemaEngine | null;
  setTakeover: (on: boolean) => void;
}

const CinemaContext = createContext<CinemaContextValue>({
  status: "static",
  engine: null,
  setTakeover: () => {},
});

export function useCinema(): CinemaContextValue {
  return useContext(CinemaContext);
}

/** 初始探测:减动效/窄屏直接 static,不建上下文 */
function probeInitialStatus(): GLStatus {
  if (typeof window === "undefined") return "static";
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

  // 先探测决定是否渲染 canvas,再在 canvas 就绪后建引擎(两段 effect)
  useEffect(() => {
    setStatus(probeInitialStatus());
    setProbed(true);
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
    <CinemaContext.Provider value={{ status, engine, setTakeover }}>
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
