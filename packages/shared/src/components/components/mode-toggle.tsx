"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import {
  applyThemeWithReveal,
  revealOriginFromEvent,
} from "@repo/ui/theme-reveal";
import { cn } from "@repo/ui/utils";

/**
 * 主题切换组件
 *
 * 功能:
 * - 在浅色、深色、系统主题之间切换
 * - 使用 next-themes 管理主题状态
 * - 切换时从触发点播放圆形揭幕动画(见 @repo/ui/theme-reveal)
 * - 支持两种显示模式: dropdown 和 inline
 */

interface ModeToggleProps {
  /**
   * 显示模式
   * - dropdown: 下拉菜单形式 (默认)
   * - inline: 并排按钮形式
   */
  variant?: "dropdown" | "inline";
  /**
   * 自定义类名
   */
  className?: string;
}

export function ModeToggle({
  variant = "dropdown",
  className,
}: ModeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("Toggle");

  /**
   * 带揭幕动画切换主题。
   * 仅当视觉外观真的会变化时才播放动画(如 light -> dark);
   * 选择 system 或点击当前主题时直接切换,避免无意义的全屏遮罩闪烁。
   */
  const switchTheme = (
    event: React.MouseEvent<HTMLElement>,
    next: "light" | "dark" | "system"
  ) => {
    const appearanceChanges = next !== "system" && next !== resolvedTheme;
    if (!appearanceChanges) {
      setTheme(next);
      return;
    }
    const { x, y } = revealOriginFromEvent(event);
    applyThemeWithReveal(x, y, () => setTheme(next));
  };

  // 内联按钮模式
  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <button
          type="button"
          onClick={(e) => switchTheme(e, "light")}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
            theme === "light"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title={t("light")}
        >
          <Sun className="h-4 w-4" />
          <span className="sr-only">{t("light")}</span>
        </button>
        <button
          type="button"
          onClick={(e) => switchTheme(e, "dark")}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
            theme === "dark"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title={t("dark")}
        >
          <Moon className="h-4 w-4" />
          <span className="sr-only">{t("dark")}</span>
        </button>
        <button
          type="button"
          onClick={(e) => switchTheme(e, "system")}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
            theme === "system"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title={t("system")}
        >
          <Monitor className="h-4 w-4" />
          <span className="sr-only">{t("system")}</span>
        </button>
      </div>
    );
  }

  // 下拉菜单模式 (默认)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className}>
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t("theme")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={(e) => switchTheme(e, "light")}>
          <Sun className="mr-2 h-4 w-4" />
          {t("light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={(e) => switchTheme(e, "dark")}>
          <Moon className="mr-2 h-4 w-4" />
          {t("dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={(e) => switchTheme(e, "system")}>
          <Monitor className="mr-2 h-4 w-4" />
          {t("system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
