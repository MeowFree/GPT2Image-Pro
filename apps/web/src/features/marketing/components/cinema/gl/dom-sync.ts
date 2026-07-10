/**
 * DOM 元素矩形到视口分数换算,供 GL 在 DOM 元素原位绘制(scrollrig 手法)。
 * 追踪器把 scroll/resize 合并到 rAF,避免高频布局读写抖动。
 */

export interface ViewportRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectToViewportFractions(
  rect: { left: number; top: number; width: number; height: number },
  vw: number,
  vh: number
): ViewportRect {
  const sw = vw > 0 ? vw : 1;
  const sh = vh > 0 ? vh : 1;
  return {
    x: rect.left / sw,
    y: rect.top / sh,
    w: rect.width / sw,
    h: rect.height / sh,
  };
}

export function trackElement(
  el: HTMLElement,
  cb: (r: ViewportRect) => void
): () => void {
  let raf: number | null = null;
  const measure = () => {
    raf = null;
    const rect = el.getBoundingClientRect();
    cb(rectToViewportFractions(rect, window.innerWidth, window.innerHeight));
  };
  const schedule = () => {
    if (raf === null) raf = requestAnimationFrame(measure);
  };
  schedule();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  return () => {
    if (raf !== null) cancelAnimationFrame(raf);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  };
}
