"use client";

/**
 * 安全设置组件
 *
 * Settings > Security Tab 的主要内容
 * 包含:
 * - 修改密码
 */

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { changePassword } from "@repo/shared/auth/client";

/**
 * 安全设置组件
 */
export function SecuritySection() {
  const t = useTranslations("Settings.security");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChangePassword = async () => {
    setError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t("errors.missingFields"));
      return;
    }

    if (newPassword.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    if (currentPassword === newPassword) {
      setError(t("errors.samePassword"));
      return;
    }

    try {
      setIsLoading(true);
      await changePassword(currentPassword, newPassword);
      toast.success(t("success"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError(t("errors.wrongPassword"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* 修改密码 */}
      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2">
          <h2 className="text-xs font-medium uppercase tracking-[1.2px] text-muted-foreground">
            {t("changePassword.title")}
          </h2>
          <Button
            size="sm"
            disabled={
              isLoading || !currentPassword || !newPassword || !confirmPassword
            }
            onClick={handleChangePassword}
          >
            {isLoading
              ? t("changePassword.updating")
              : t("changePassword.submit")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("changePassword.description")}
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-w-md space-y-4">
          <div className="space-y-2">
            <Label
              htmlFor="current-password"
              className="text-xs uppercase tracking-[0.6px] text-muted-foreground"
            >
              {t("changePassword.currentPassword")}
            </Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showPasswords ? "text" : "password"}
                placeholder={t("changePassword.currentPasswordPlaceholder")}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={isLoading}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPasswords ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="new-password"
              className="text-xs uppercase tracking-[0.6px] text-muted-foreground"
            >
              {t("changePassword.newPassword")}
            </Label>
            <Input
              id="new-password"
              type={showPasswords ? "text" : "password"}
              placeholder={t("changePassword.newPasswordPlaceholder")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="confirm-password"
              className="text-xs uppercase tracking-[0.6px] text-muted-foreground"
            >
              {t("changePassword.confirmPassword")}
            </Label>
            <Input
              id="confirm-password"
              type={showPasswords ? "text" : "password"}
              placeholder={t("changePassword.confirmPasswordPlaceholder")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
