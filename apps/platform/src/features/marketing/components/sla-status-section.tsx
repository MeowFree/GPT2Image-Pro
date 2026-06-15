"use client";

import { Button } from "@repo/ui/components/button";
import { Eye, Loader2, X } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import type { GenerationSlaStats } from "@repo/image-generation/sla";
import { updateMarketingSlaStatusVisibilityAction } from "@/features/marketing/actions/sla-status";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
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

  const items = [
    {
      label: copy("Completed", "成功生成"),
      value: formatNumber(stats.completed),
    },
    {
      label: copy("Platform / upstream errors", "平台或上游错误"),
      value: formatNumber(stats.platformErrors),
    },
    {
      label: copy("Moderation stops", "审核拦截或异常"),
      value: formatNumber(stats.moderationErrors),
    },
    {
      label: copy("User request errors", "用户请求错误"),
      value: formatNumber(stats.userRequestErrors),
    },
  ];

  if (!visible) {
    if (!canToggleVisibility) return null;
    return (
      <section className="border-y bg-muted/25">
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
    <section className="border-y bg-muted/25">
      <div className="container py-10">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_2fr] lg:items-center">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {copy(
                `Live sample: latest ${formatNumber(stats.sampleSize)} finished generations`,
                `实时样本：最近 ${formatNumber(stats.sampleSize)} 张已完结生成记录`
              )}
            </p>
            <h2 className="mt-2 font-serif text-2xl font-medium tracking-tight">
              {copy("Generation SLA", "生图服务 SLA")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {copy(
                "Availability excludes moderation stops and invalid user requests, so platform reliability is visible separately from request quality.",
                "可用性统计剔除审核拦截和用户请求错误，单独展示平台侧可靠性。"
              )}
            </p>
            {canToggleVisibility && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
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

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border bg-background p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {copy("SLA", "SLA")}
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {formatPercent(stats.successRate)}
              </p>
            </div>
            {items.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border bg-background p-4"
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
