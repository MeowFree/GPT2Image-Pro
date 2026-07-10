"use client";

/**
 * 积分使用情况组件
 *
 * Settings > Usage Tab 的主要内容
 * 包含:
 * - 可用积分余额
 * - 购买积分入口
 * - 即将过期积分提示
 * - 订阅状态
 * - 交易历史
 */

import { Clock, Coins } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect } from "react";

import { formatDateInTimeZone } from "../../time-zone";
import { Button } from "@repo/ui/components/button";
import { Separator } from "@repo/ui/components/separator";
import {
  getMyActiveBatches,
  getMyCreditsBalance,
} from "../actions";
import { formatCredits } from "../format";

import { TransactionHistory } from "./transaction-history";

/**
 * 格式化日期
 */
function formatDate(
  date: Date | string | null,
  locale: string,
  timeZone: string
): string {
  if (!date) return "Never";
  return formatDateInTimeZone(date, locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }, timeZone);
}

/**
 * 积分使用情况组件
 */
export function CreditUsageSection({ timeZone }: { timeZone: string }) {
  const t = useTranslations("Settings.usage");
  const locale = useLocale();

  // 获取积分余额
  const {
    execute: fetchBalance,
    result: balanceResult,
    isPending: isBalanceLoading,
  } = useAction(getMyCreditsBalance);

  // 获取活跃批次（用于显示即将过期）
  const { execute: fetchBatches, result: batchesResult } =
    useAction(getMyActiveBatches);

  // 组件挂载时获取余额；余额 Action 会先懒发注册送积分。
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // 确认余额后再拉批次，避免注册送积分刚补发时分类明细滞后。
  useEffect(() => {
    if (!balanceResult.data) return;
    fetchBatches();
  }, [balanceResult.data, fetchBatches]);

  const balance = balanceResult.data?.balance ?? 0;
  const batches = batchesResult.data ?? [];
  const creditsBySource = batches.reduce<Record<string, number>>(
    (totals, batch) => {
      totals[batch.sourceType] =
        (totals[batch.sourceType] ?? 0) + batch.remaining;
      return totals;
    },
    {}
  );
  const breakdownItems = (
    ["bonus", "purchase", "subscription", "refund"] as const
  )
    .map((source) => ({
      source,
      amount: creditsBySource[source] ?? 0,
    }))
    .filter((item) => item.amount > 0);

  // 找到最近即将过期的批次
  const expiringBatch = batches
    .filter((b) => b.expiresAt !== null)
    .sort((a, b) => {
      if (!a.expiresAt || !b.expiresAt) return 0;
      return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
    })[0];

  return (
    <div className="space-y-8">
      {/* 标题 */}
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {/* 可用积分 */}
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/15">
            <Coins className="h-5 w-5 text-warning" />
          </div>
          <span className="font-medium">{t("availableCredits")}</span>
        </div>

        <div className="text-right">
          {isBalanceLoading ? (
            <div className="animate-pulse">
              <div className="h-10 w-16 bg-muted rounded" />
            </div>
          ) : (
            <>
              <div className="text-4xl font-bold">
                {formatCredits(balance)}
              </div>
              <div className="text-sm text-muted-foreground">
                {t("creditsAvailable")}
              </div>
            </>
          )}
        </div>
      </div>

      {breakdownItems.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-4">
          {breakdownItems.map((item) => (
            <div
              key={item.source}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <div className="text-muted-foreground">
                {t(`sources.${item.source}`)}
              </div>
              <div className="font-medium">{formatCredits(item.amount)}</div>
            </div>
          ))}
        </div>
      )}

      <Separator />

      {/* 购买更多积分 */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">{t("getMoreCredits.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("getMoreCredits.description")}
          </p>
        </div>

        <div className="flex gap-3">
          <Button asChild>
            <Link href={`/${locale}/dashboard/credits/buy`}>
              {t("getMoreCredits.buyCredits")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/${locale}/#pricing`}>
              {t("getMoreCredits.viewPlans")}
            </Link>
          </Button>
        </div>
      </div>

      {/* 即将过期积分提示 */}
      {expiringBatch && (
        <>
          <Separator />
          <div className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-warning" />
              <div>
                <p className="font-medium text-warning">
                  {t("expiringSoon.title")}
                </p>
                <p className="text-sm text-warning/80">
                  {t("expiringSoon.message", {
                    count: formatCredits(expiringBatch.remaining),
                    date: formatDate(expiringBatch.expiresAt, locale, timeZone),
                  })}
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* 交易历史 */}
      <TransactionHistory timeZone={timeZone} />
    </div>
  );
}
