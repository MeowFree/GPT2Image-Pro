"use client";

/**
 * 购买积分套餐视图组件
 *
 * 展示积分套餐列表，允许用户选择并购买
 * 设计风格：GPT2IMAGE 黑白简约
 */

import { createCreditsPurchaseCheckout } from "@repo/shared/credits/actions";
import {
  CREDIT_PACKAGES,
  CREDITS_EXPIRY_DAYS,
} from "@repo/shared/credits/config";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@repo/ui/components/card";
import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/utils";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * 购买积分套餐视图
 */
export function BuyCreditPackagesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canceled = searchParams.get("canceled");

  // 创建 Checkout Session
  const { execute, isPending } = useAction(createCreditsPurchaseCheckout, {
    onSuccess: ({ data }) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "Failed to create checkout session");
    },
  });

  // 显示取消提示
  useEffect(() => {
    if (canceled) {
      toast.info("Payment canceled");
      router.replace("/dashboard/credits/buy");
    }
  }, [canceled, router]);

  /**
   * 处理购买按钮点击
   */
  const handlePurchase = (packageId: "lite" | "standard" | "pro") => {
    execute({ packageId });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      {/* 页面标题 */}
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-medium tracking-tight">
          Buy Credits
        </h1>
        <p className="text-muted-foreground">
          One-time credit packages. No subscription required. Credits are valid
          for {CREDITS_EXPIRY_DAYS} days after purchase.
        </p>
      </div>

      <Separator />

      {/* 套餐列表 */}
      <div className="grid gap-6 sm:grid-cols-3">
        {CREDIT_PACKAGES.map((pkg) => {
          const isPopular = "popular" in pkg && pkg.popular;
          const perCredit = (pkg.price / pkg.credits).toFixed(2);

          return (
            <Card
              key={pkg.id}
              className={cn(
                "relative flex flex-col rounded-xl border transition-shadow",
                isPopular
                  ? "border-foreground shadow-md"
                  : "border-border hover:shadow-sm"
              )}
            >
              {/* 热门标签 */}
              {isPopular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs">
                  Best Value
                </Badge>
              )}

              <CardHeader className="pb-3 pt-6 text-center">
                <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  {pkg.name}
                </p>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col items-center space-y-4 px-6">
                {/* 积分数量 */}
                <div className="text-center">
                  <span className="font-serif text-5xl font-bold tracking-tight">
                    {pkg.credits.toLocaleString()}
                  </span>
                  <p className="mt-1 text-sm text-muted-foreground">credits</p>
                </div>

                <Separator />

                {/* 价格 */}
                <div className="text-center">
                  <span className="text-3xl font-semibold">¥{pkg.price}</span>
                  <span className="ml-1 text-sm text-muted-foreground">
                    CNY
                  </span>
                </div>

                {/* 描述 + 每积分价格 */}
                <p className="text-center text-xs text-muted-foreground">
                  {pkg.description}
                </p>

                {/* 特性列表 */}
                <ul className="w-full space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
                    Instant delivery
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
                    Valid for {CREDITS_EXPIRY_DAYS} days
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />¥
                    {perCredit} per credit
                  </li>
                </ul>
              </CardContent>

              <CardFooter className="px-6 pb-6 pt-2">
                <Button
                  className="w-full"
                  variant={isPopular ? "default" : "outline"}
                  disabled={isPending}
                  onClick={() =>
                    handlePurchase(pkg.id as "lite" | "standard" | "pro")
                  }
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    `Buy ${pkg.credits.toLocaleString()} Credits`
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* 返回链接 */}
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => router.push("/dashboard/settings?tab=usage")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Usage
        </Button>
      </div>
    </div>
  );
}
