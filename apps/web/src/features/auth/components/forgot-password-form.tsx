"use client";

import { KeyRound, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useState } from "react";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { forgetPassword } from "@repo/shared/auth/client";

import { AuthErrorAlert } from "./auth-error-alert";

/**
 * 忘记密码表单组件
 *
 * 功能:
 * - 输入邮箱地址
 * - 发送密码重置链接
 * - 显示成功/错误状态
 */
export function ForgotPasswordForm() {
  const locale = useLocale();
  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  // 表单状态
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const startResendCooldown = () => {
    setResendCooldown(60);
    const timer = setInterval(() => {
      setResendCooldown((current) => {
        if (current <= 1) {
          clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const sendResetLink = async () => {
    const normalizedEmail = email.trim();
    await forgetPassword(normalizedEmail, `/${locale}/reset-password`);
    setEmail(normalizedEmail);
  };

  /**
   * 处理表单提交
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      setError(copy("Please enter your email address", "请输入邮箱地址"));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      await sendResetLink();

      setIsSuccess(true);
      startResendCooldown();
    } catch {
      setError(
        copy(
          "Failed to send reset link. Please try again.",
          "重置链接发送失败，请稍后重试。"
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isLoading) return;

    try {
      setIsLoading(true);
      setError(null);
      await sendResetLink();
      startResendCooldown();
    } catch {
      setError(
        copy(
          "Failed to resend reset link. Please try again.",
          "重置链接重发失败，请稍后重试。"
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  // 成功状态显示
  if (isSuccess) {
    return (
      <div className="w-full space-y-6">
        {/* 图标 */}
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="font-serif text-2xl font-medium tracking-tight">
            {copy("Check your email", "请查看邮箱")}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {copy("We've sent a password reset link to", "密码重置链接已发送至")}{" "}
            <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>

        <AuthErrorAlert message={error} />

        <div className="space-y-3 text-center">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleResend}
            disabled={isLoading || resendCooldown > 0}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {copy("Sending...", "发送中...")}
              </>
            ) : resendCooldown > 0 ? (
              copy(
                `Resend in ${resendCooldown}s`,
                `${resendCooldown}秒后可重新发送`
              )
            ) : (
              copy("Resend reset link", "重新发送重置链接")
            )}
          </Button>
          <Link
            href={`/${locale}/sign-in`}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors duration-150"
          >
            {copy("Back to Login", "返回登录")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* Logo 和标题 */}
      <div className="flex flex-col items-center space-y-4 text-center">
        {/* Logo 图标 */}
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {copy("Forgot your password?", "忘记密码？")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {copy(
            "Enter your email below and we'll send you a link to reset it.",
            "输入邮箱后，我们会向你发送密码重置链接。"
          )}
        </p>
      </div>

      {/* 错误提示 */}
      <AuthErrorAlert message={error} />

      {/* 表单 */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 邮箱输入 */}
        <div className="space-y-2">
          <Label htmlFor="email">{copy("Email address", "邮箱地址")}</Label>
          <Input
            id="email"
            type="email"
            placeholder="jane@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="email"
            autoFocus
          />
        </div>

        {/* 提交按钮 */}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {copy("Sending...", "发送中...")}
            </>
          ) : (
            copy("Send reset password link", "发送密码重置链接")
          )}
        </Button>
      </form>

      {/* 返回登录链接 */}
      <p className="text-center text-sm text-muted-foreground">
        {copy("Remember your password?", "想起密码了？")}{" "}
        <Link
          href={`/${locale}/sign-in`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {copy("Back to Login", "返回登录")}
        </Link>
      </p>
    </div>
  );
}
