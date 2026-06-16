"use client";

/**
 * 全局状态手动刷新按钮。
 *
 * 全局状态数据被缓存 120s(unstable_cache)。点击刷新:server action 失效缓存 tag,
 * 成功后 router.refresh() 重渲染当前路由,使服务端重算并展示最新聚合。仅管理员可用
 * (action 走 adminAction 鉴权)。
 */

import { Button } from "@repo/ui/components/button";
import { RefreshCw } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { useRouter } from "@/i18n/routing";
import { refreshGlobalStatusAction } from "./actions";

export function RefreshStatusButton({
  label,
  refreshingLabel,
  errorLabel,
}: {
  label: string;
  refreshingLabel: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const { execute, isPending } = useAction(refreshGlobalStatusAction, {
    onSuccess: () => router.refresh(),
    onError: () => toast.error(errorLabel),
  });

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => execute()}
      className="w-fit"
    >
      <RefreshCw className={isPending ? "animate-spin" : ""} />
      {isPending ? refreshingLabel : label}
    </Button>
  );
}
