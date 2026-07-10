"use client";

// 文件职责：瀑布流(批量)模式的额度消耗警告弹窗。
// 使用方：create-page-client.tsx 在两个时机渲染——
//   (a) 首次进入瀑布流模式(first-time)；
//   (b) 本会话累计生成数跨越里程碑阈值(milestone)。
// 关键依赖：@repo/ui 的 Dialog/Button；localStorage 持久化“首次提示已看过”标记。
// WHY：瀑布流每批并发生成 tier 张，积分消耗远高于单图，需在前端显著提示，避免用户误扣。
// 文案语言由父组件统一的 copy(en, zh) 注入，保证与页面其它文案语言一致。

import { AlertTriangle } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { useCallback } from "react";

// 与原项目保持一致的存储键，延续老用户的“已看过首次提示”标记
const STORAGE_KEY = "gpt2image_waterfall_warned";

// 警告类型：首次使用提示 / 里程碑用量提醒
export type WaterfallWarningType = "first-time" | "milestone";

export interface WaterfallWarningPopupProps {
  type: WaterfallWarningType;
  // 当前每批并发张数(tier)，用于首次提示文案
  tier: number;
  // 本会话累计已生成张数，用于里程碑提示文案
  count: number;
  // 父组件统一的中英文案选择器
  copy: (en: string, zh: string) => string;
  onClose: () => void;
}

// 是否已展示过首次使用警告。
// SSR 安全：window 不存在时按“已看过”处理(不弹)，交由客户端 effect 再判断。
export function hasSeenWaterfallFirstTimeWarning(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage 不可用(隐私模式等)时按“已看过”处理，避免反复弹窗
    return true;
  }
}

// 标记首次使用警告已展示，后续不再弹出
export function markWaterfallFirstTimeWarningSeen(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage 不可用时静默降级，不阻断功能
  }
}

export function WaterfallWarningPopup({
  type,
  tier,
  count,
  copy,
  onClose,
}: WaterfallWarningPopupProps) {
  // 确认按钮：首次提示落 localStorage；里程碑提示仅关闭(解除阻塞由父组件在 onClose 内处理)
  const handleConfirm = useCallback(() => {
    if (type === "first-time") {
      markWaterfallFirstTimeWarningSeen();
    }
    onClose();
  }, [type, onClose]);

  const title =
    type === "first-time"
      ? copy("Credit Consumption Warning", "额度消耗提醒")
      : copy("Usage Reminder", "用量提醒");

  const body =
    type === "first-time"
      ? copy(
          `Waterfall mode generates ${tier} image(s) per batch at once and consumes credits much faster than single generation. Scrolling down keeps generating more batches automatically.`,
          `瀑布流模式每批次同时生成 ${tier} 张图片，积分消耗远高于单张生成。向下滚动会自动继续生成更多批次。`
        )
      : copy(
          `You have generated about ${count} image(s) in this session and credits are being consumed rapidly. Continue?`,
          `本次会话已生成约 ${count} 张图片，积分正在快速消耗。是否继续？`
        );

  const confirmLabel =
    type === "first-time"
      ? copy("I Understand, Continue", "我已了解，继续使用")
      : copy("Continue", "继续");

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
