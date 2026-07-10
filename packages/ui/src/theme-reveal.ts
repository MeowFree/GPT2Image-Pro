/**
 * 主题切换圆形揭幕动画(从触发点向外收缩揭示新主题)。
 *
 * 使用方:mode-toggle 等主题切换组件。
 * 原理:先用旧主题背景色的全屏遮罩盖住页面,再执行主题切换,
 * 然后以 clip-path circle 从触发点收缩遮罩,视觉上呈现新主题
 * 自点击处扩散开来的效果。纯 DOM 实现,不依赖 View Transitions API,
 * 全浏览器可用;动画只操作 clip-path(合成层),无布局抖动。
 *
 * 边界与降级:
 * - SSR / 无 document:直接执行切换,无动画。
 * - prefers-reduced-motion: reduce:直接切换,尊重系统偏好。
 * - 主题切换由 next-themes 异步应用 class,这里用双 rAF 等一帧
 *   React 提交后再开始收缩,避免遮罩揭开时旧主题还未翻转。
 */

/** 揭幕收缩时长,与 --transition-slow(400ms)同数量级但稍长以显从容。 */
const REVEAL_DURATION_MS = 550;

/**
 * 以圆形揭幕动画执行主题切换。
 *
 * @param x     - 动画圆心视口 X 坐标(通常取触发按钮中心)
 * @param y     - 动画圆心视口 Y 坐标
 * @param apply - 实际执行主题切换的回调(如 () => setTheme("dark"))
 */
export function applyThemeWithReveal(
  x: number,
  y: number,
  apply: () => void
): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    apply();
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }

  // 旧主题背景色:从 body 计算样式实时读取,不硬编码,主题色改动零维护。
  const oldBg = getComputedStyle(document.body).backgroundColor;
  const maxX = Math.max(x, window.innerWidth - x);
  const maxY = Math.max(y, window.innerHeight - y);
  const maxRadius = Math.ceil(Math.hypot(maxX, maxY));

  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "pointer-events:none",
    `background:${oldBg}`,
    `clip-path:circle(${maxRadius}px at ${x}px ${y}px)`,
  ].join(";");
  document.body.appendChild(overlay);

  apply();

  // 双 rAF:第一帧让 React/next-themes 提交 class 变更,第二帧启动收缩。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.style.transition = `clip-path ${REVEAL_DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      overlay.style.clipPath = `circle(0px at ${x}px ${y}px)`;
    });
  });

  const cleanup = () => {
    if (overlay.parentNode) overlay.remove();
  };
  overlay.addEventListener("transitionend", cleanup, { once: true });
  // 兜底:transitionend 偶发不触发(标签页切走等),定时强制清理。
  window.setTimeout(cleanup, REVEAL_DURATION_MS + 450);
}

/**
 * 从鼠标/键盘事件解析动画圆心:
 * 鼠标点击用 clientX/Y;键盘激活(coords 为 0)回退到触发元素中心。
 */
export function revealOriginFromEvent(event: {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
}): { x: number; y: number } {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY };
  }
  const el = event.currentTarget;
  if (el instanceof Element) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
