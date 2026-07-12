"use client";

/**
 * 谷段通用滚动显影(v1.0.2 跟随化收尾):把谷段剩余的静态元素纳入
 * 影片的镜头语言——元素以自身进入视口的位置为进度(元素级
 * useScroll),随滚动自下方浮起显影,滚回即倒放;spring 只作平滑
 * 跟随,目标恒为滚动纯函数。
 * - phase:同容器多元素的相位错落(0-1,后相位者更晚显影),
 *   用于标题三行/例言逐条/墨笺逐张的"逐个跟随"。
 * - tilt:落定前的微倾角(度),用于墨笺落案的纸片感;0 则纯浮起。
 * transform(y/rotate)与 opacity 分层绑定(铁律:混绑订阅失效);
 * mounted 门闩保 SSR/无 JS 输出终态;减动效直接终态。
 * 使用方:<InkReveal phase={0.2}><h2>…</h2></InkReveal>
 */
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 显影活跃门:mounted 且非减动效才挂滚动样式。子组件各自调用
 * 会在同一区块产生多份 matchMedia/effect,由使用方经 Provider
 * 一次判定即可;无 Provider 时组件内自判(独立使用兜底)。
 */
const InkRevealActiveContext = createContext<boolean | null>(null);

export function InkRevealBoundary({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <InkRevealActiveContext.Provider value={mounted && !reduceMotion}>
      {children}
    </InkRevealActiveContext.Provider>
  );
}

function useInkRevealActive(): boolean {
  const fromContext = useContext(InkRevealActiveContext);
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (fromContext !== null) return fromContext;
  return mounted && !reduceMotion;
}

export function InkReveal({
  children,
  phase = 0,
  tilt = 0,
  className,
}: {
  children: ReactNode;
  /** 相位错落 0-1:显影窗口按相位后移,同容器元素逐个跟随 */
  phase?: number;
  /** 落定前微倾角(度):墨笺/纸片的落案感 */
  tilt?: number;
  className?: string;
}) {
  const active = useInkRevealActive();
  const ref = useRef<HTMLDivElement | null>(null);
  // 窗口:元素顶从视口 97% 走到 70%;相位平移起点、压缩跨度,
  // 保证任何相位在窗口尾都收敛到 1(倒放对称)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.97", "start 0.7"],
  });
  const reveal = useSpring(
    useTransform(scrollYProgress, (v) => {
      const shift = phase * 0.45;
      return clamp01((clamp01(v) - shift) / (1 - shift));
    }),
    { stiffness: 150, damping: 24 }
  );
  const opacity = useTransform(reveal, (v) => Math.min(1, v * 1.45));
  const y = useTransform(reveal, (v) => (1 - v) * 22);
  const rotate = useTransform(reveal, (v) => (1 - v) * tilt);

  return (
    <motion.div
      ref={ref}
      style={active ? { opacity } : undefined}
      className={className}
    >
      <motion.div
        style={
          active
            ? { y, rotate, transformOrigin: "top center" }
            : undefined
        }
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/**
 * 装裱横线:自中心向两侧生长的发丝线(标题的装裱横档)。
 * 独立小件,同一显影语言;宽度由使用方 className 控制。
 */
export function InkRule({ className }: { className?: string }) {
  const active = useInkRevealActive();
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.96", "start 0.72"],
  });
  const scaleX = useSpring(
    useTransform(scrollYProgress, (v) => clamp01(v)),
    { stiffness: 120, damping: 22 }
  );
  return (
    <div ref={ref} aria-hidden="true" className={className}>
      <motion.div
        style={active ? { scaleX } : undefined}
        className="h-px origin-center bg-foreground/45"
      />
    </div>
  );
}
