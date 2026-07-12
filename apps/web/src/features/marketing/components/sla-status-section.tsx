"use client";

/**
 * 谷段一折「千笔之约」:生图 SLA 的水墨数据可视化(v1.0 剧情化)。
 * 可靠性不是读数字,是亲眼看见——最近上千张已完结生成化作一片
 * 墨点雨,入场时按波次落在纸面排成点阵:成功 = 墨点,平台或上游
 * 错误 = 朱色空圈,审核拦截与用户请求错误 = 淡灰点(不计入可用性
 * 的两类以低对比呈现);随后成功率大数字浮现,图例以点色对应。
 * 点序经固定种子洗牌(错误散布其间,如实呈现);reduced-motion 与
 * 视口外直接呈现终态,数据真相不依赖动画。
 * 管理员可见性开关(server action)原样保留。
 */
import { Button } from "@repo/ui/components/button";
import { Eye, Loader2, X } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { GenerationSlaStats } from "@/features/image-generation/sla";
import { updateMarketingSlaStatusVisibilityAction } from "@/features/marketing/actions/sla-status";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

/** 点类型:与图例一一对应 */
type DotKind = "ok" | "platform" | "muted";

const DOT_COLORS: Record<DotKind, string> = {
  ok: "#221d1a",
  platform: "#a8352a",
  muted: "#c9c2b4",
};

/** 确定性洗牌种子随机(与水墨引擎同式) */
function mulberry32(a: number) {
  let state = a | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由统计构造点序列(封顶 1000,按比例取整,成功补齐余数,固定种子洗牌) */
function buildDots(stats: GenerationSlaStats): DotKind[] {
  const total = Math.max(
    1,
    Math.min(1000, stats.sampleSize || stats.completed)
  );
  const sum = Math.max(1, stats.sampleSize || 1);
  const platform = Math.round((stats.platformErrors / sum) * total);
  const muted = Math.round(
    ((stats.moderationErrors + stats.userRequestErrors) / sum) * total
  );
  const ok = Math.max(0, total - platform - muted);
  const dots: DotKind[] = [
    ...Array.from({ length: ok }, () => "ok" as const),
    ...Array.from({ length: platform }, () => "platform" as const),
    ...Array.from({ length: muted }, () => "muted" as const),
  ];
  const rnd = mulberry32(97);
  for (let i = dots.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = dots[i] as DotKind;
    dots[i] = dots[j] as DotKind;
    dots[j] = a;
  }
  return dots;
}

/**
 * 点阵画布:入场按波次落点(约 1.6s),终态与动画中间态均由同一
 * 绘制函数产出(重入/resize/reduced-motion 都收敛到同一真相)。
 */
function DotField({ dots }: { dots: DotKind[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playedRef = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cols = 50;
    const rows = Math.ceil(dots.length / cols);
    let raf = 0;
    const draw = (progress: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = (w / cols) * rows;
      canvas.height = Math.round(h * dpr);
      canvas.width = Math.round(w * dpr);
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      const cell = w / cols;
      const r = cell * 0.22;
      const shown = Math.floor(progress * dots.length);
      for (let i = 0; i < shown; i++) {
        const kind = dots[i] as DotKind;
        const cx = (i % cols) * cell + cell / 2;
        const cy = Math.floor(i / cols) * cell + cell / 2;
        // 刚落下的点略大(着纸未收),随后回到常规半径
        const age = (progress * dots.length - i) / dots.length;
        const radius = r * (age < 0.02 ? 1.5 - age * 25 : 1);
        ctx.beginPath();
        ctx.arc(cx, cy, kind === "muted" ? radius * 0.8 : radius, 0, 7);
        if (kind === "platform") {
          ctx.strokeStyle = DOT_COLORS.platform;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
          ctx.fillStyle = DOT_COLORS[kind];
          ctx.fill();
        }
      }
    };
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const play = () => {
      if (playedRef.current) return;
      playedRef.current = true;
      if (reduced) {
        draw(1);
        return;
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 1600);
        draw(p);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) play();
      },
      { threshold: 0.3 }
    );
    io.observe(canvas);
    const onResize = () => {
      if (playedRef.current) draw(1);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [dots]);
  return <canvas ref={canvasRef} aria-hidden="true" className="w-full" />;
}

export function SlaStatusSection({
  locale,
  stats,
  canToggleVisibility = false,
  initiallyEnabled = true,
}: {
  locale: string;
  stats: GenerationSlaStats;
  canToggleVisibility?: boolean;
  initiallyEnabled?: boolean;
}) {
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const [visible, setVisible] = useState(initiallyEnabled);
  const { execute: updateVisibility, isPending } = useAction(
    updateMarketingSlaStatusVisibilityAction,
    {
      onSuccess: ({ data }) => {
        const enabled = data?.enabled ?? false;
        setVisible(enabled);
        toast.success(
          data?.message ||
            (enabled
              ? copy("Homepage SLA enabled", "首页 SLA 已开启")
              : copy("Homepage SLA hidden", "首页 SLA 已关闭"))
        );
      },
      onError: ({ error }) => {
        toast.error(
          error.serverError ||
            copy("Failed to update SLA display", "更新 SLA 展示失败")
        );
      },
    }
  );

  const legend = [
    {
      kind: "ok" as const,
      label: copy("Completed", "成功生成"),
      value: formatNumber(stats.completed),
    },
    {
      kind: "platform" as const,
      label: copy("Platform / upstream errors", "平台或上游错误"),
      value: formatNumber(stats.platformErrors),
    },
    {
      kind: "muted" as const,
      label: copy(
        "Moderation stops / request errors",
        "审核拦截与请求错误"
      ),
      value: formatNumber(stats.moderationErrors + stats.userRequestErrors),
    },
  ];

  if (!visible) {
    if (!canToggleVisibility) return null;
    return (
      <section className="border-y border-border/60 bg-secondary/50">
        <div className="container flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              {copy("Homepage SLA is hidden", "首页 SLA 已隐藏")}
            </p>
            <p className="text-xs text-muted-foreground">
              {copy(
                "This only affects the marketing homepage. Admin status pages are unchanged.",
                "该开关只影响营销主页，后台状态页不受影响。"
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => updateVisibility({ enabled: true })}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            {copy("Show SLA", "开启 SLA")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="border-y border-border/60 bg-secondary/50">
      <div className="container py-16 md:py-20">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_2fr] lg:items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {copy("Generation SLA", "生图服务 SLA")}
            </p>
            <h2 className="mt-2 font-serif text-3xl font-medium tracking-tight">
              {copy("Every stroke lands", "千笔之约")}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {copy(
                `The latest ${formatNumber(stats.sampleSize)} finished generations, each one a dot of ink on this paper. Availability excludes moderation stops and invalid requests, so platform reliability is visible separately.`,
                `最近 ${formatNumber(stats.sampleSize)} 张已完结生成，每一张都是这页纸上的一点墨。可用性剔除审核拦截与请求错误，平台侧可靠性单独可见。`
              )}
            </p>
            <p className="mt-6 font-serif text-5xl font-medium tracking-tight">
              {formatPercent(stats.successRate)}
            </p>
            <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
              {copy("availability", "可用性")}
            </p>
            {canToggleVisibility && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-6"
                onClick={() => updateVisibility({ enabled: false })}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                {copy("Hide homepage SLA", "关闭首页 SLA")}
              </Button>
            )}
          </div>

          <div>
            <DotField dots={buildDots(stats)} />
            <ul className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
              {legend.map((item) => (
                <li
                  key={item.kind}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={
                      item.kind === "platform"
                        ? {
                            border: `1.4px solid ${DOT_COLORS.platform}`,
                          }
                        : { backgroundColor: DOT_COLORS[item.kind] }
                    }
                  />
                  {item.label}
                  <span className="font-medium text-foreground/80">
                    {item.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
