"use client";

import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { resetPassword } from "@repo/shared/auth/client";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { AuthErrorAlert } from "./auth-error-alert";

export function ResetPasswordForm() {
  const locale = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : copy("Reset link is invalid or expired.", "重置链接无效或已过期。")
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) {
      setError(copy("Reset link is invalid or expired.", "重置链接无效或已过期。"));
      return;
    }
    if (password.length < 8) {
      setError(
        copy("Password must be at least 8 characters.", "密码至少需要 8 个字符。")
      );
      return;
    }
    if (password !== confirmPassword) {
      setError(copy("Passwords do not match.", "两次输入的密码不一致。"));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      await resetPassword(password, token);
      setIsSuccess(true);
    } catch {
      setError(
        copy(
          "Failed to reset password. Please request a new reset link.",
          "密码重置失败，请重新获取重置链接。"
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="w-full space-y-6">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="font-serif text-2xl font-medium tracking-tight">
            {copy("Password updated", "密码已更新")}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {copy(
              "You can now sign in with your new password.",
              "现在可以使用新密码登录。"
            )}
          </p>
        </div>

        <Button asChild className="w-full">
          <Link href={`/${locale}/sign-in`}>
            {copy("Back to sign in", "返回登录")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {copy("Reset your password", "重置密码")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {copy(
            "Enter a new password for your account.",
            "请输入账号的新密码。"
          )}
        </p>
      </div>

      <AuthErrorAlert message={error} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{copy("New password", "新密码")}</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isLoading || !token}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">
            {copy("Confirm password", "确认密码")}
          </Label>
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={isLoading || !token}
            autoComplete="new-password"
          />
        </div>

        <Button type="submit" className="w-full" disabled={isLoading || !token}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {copy("Updating...", "更新中...")}
            </>
          ) : (
            copy("Update password", "更新密码")
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href={`/${locale}/forgot-password`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {copy("Request a new reset link", "重新获取重置链接")}
        </Link>
      </p>
    </div>
  );
}
