"use client";

import {
  resendVerificationEmail,
  sendRegistrationVerificationCode,
  signInWithGoogle,
  signUpWithEmail,
} from "@repo/shared/auth/client";
import {
  ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST,
  isAllowedRegistrationEmail,
} from "@repo/shared/auth/email-domain";
import { GoogleIcon } from "@repo/shared/components/icons";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Separator } from "@repo/ui/components/separator";
import { Eye, EyeOff, Mail } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { AuthErrorAlert } from "./auth-error-alert";
import { AuthLogo } from "./auth-logo";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "";
}

function getAuthErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return "";
}

function isEmailAlreadyRegistered(error: unknown) {
  const code = getAuthErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();

  return (
    code === "EMAIL_ALREADY_REGISTERED" ||
    code === "USER_ALREADY_EXISTS" ||
    code === "ACCOUNT_DELETED" ||
    message.includes("already registered") ||
    message.includes("already in use") ||
    message.includes("account has been deleted")
  );
}

function isEmailDomainError(error: unknown) {
  const code = getAuthErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();

  return code === "EMAIL_DOMAIN_NOT_ALLOWED" || message.includes("email domain");
}

function isVerificationCodeError(error: unknown) {
  const code = getAuthErrorCode(error);

  return (
    code === "INVALID_VERIFICATION_CODE" ||
    code === "VERIFICATION_CODE_REQUIRED"
  );
}

/**
 * 注册表单组件
 *
 * 功能:
 * - Google OAuth 注册
 * - GitHub OAuth 注册
 * - 邮箱密码注册
 */
interface SignUpFormProps {
  googleAuthEnabled?: boolean;
}

export function SignUpForm({ googleAuthEnabled = false }: SignUpFormProps) {
  const locale = useLocale();
  const t = useTranslations("Auth.signUp");
  const tCommon = useTranslations("Auth.common");

  // 表单状态
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const isAllowedEmail = (value: string) => isAllowedRegistrationEmail(value);
  const allowedEmailDomains = ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST.join(", ");
  const emailDomainError = t("errors.emailDomainNotAllowed", {
    domains: allowedEmailDomains,
  });
  const trimmedEmail = email.trim();
  const showEmailDomainError =
    trimmedEmail.includes("@") && !isAllowedEmail(trimmedEmail);

  /**
   * 启动重发冷却倒计时
   */
  const startCooldown = () => {
    setResendCooldown(60);
    const timer = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /**
   * 启动验证码发送冷却倒计时
   */
  const startCodeCooldown = () => {
    setCodeCooldown(60);
    const timer = setInterval(() => {
      setCodeCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /**
   * 重新发送验证邮件
   */
  const handleResendEmail = async () => {
    if (resendCooldown > 0) return;

    try {
      await resendVerificationEmail(email);
      startCooldown();
    } catch {
      // 静默失败，不暴露用户是否存在
    }
  };

  /**
   * 发送注册验证码
   */
  const handleSendCode = async () => {
    if (codeCooldown > 0 || isSendingCode) return;

    if (!email) {
      setError(t("errors.missingEmail"));
      return;
    }

    if (!isAllowedEmail(email)) {
      setError(emailDomainError);
      return;
    }

    try {
      setIsSendingCode(true);
      setError(null);
      await sendRegistrationVerificationCode(email);
      startCodeCooldown();
      toast.success(t("verificationCode.sent"));
    } catch (error) {
      setError(
        isEmailDomainError(error)
          ? emailDomainError
          : isEmailAlreadyRegistered(error)
            ? t("errors.emailAlreadyRegistered")
            : t("errors.verificationSendFailed")
      );
    } finally {
      setIsSendingCode(false);
    }
  };

  /**
   * 处理 Google 注册
   */
  const handleGoogleSignUp = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await signInWithGoogle();
    } catch {
      setError(t("errors.google"));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 处理邮箱密码注册
   */
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !email || !password || !verificationCode) {
      setError(t("errors.missingFields"));
      return;
    }

    if (!isAllowedEmail(email)) {
      setError(emailDomainError);
      return;
    }

    if (password.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await signUpWithEmail(
        email,
        password,
        name,
        verificationCode
      );

      if (result.error) {
        setError(
          isEmailDomainError(result.error)
            ? emailDomainError
            : isVerificationCodeError(result.error)
              ? t("errors.invalidVerificationCode")
              : isEmailAlreadyRegistered(result.error)
            ? t("errors.emailAlreadyRegistered")
            : t("errors.emailInUse")
        );
        setIsLoading(false);
        return;
      }

      // 注册成功，显示验证邮件提示
      if (result.data?.token) {
        toast.success(tCommon("success"));
        window.location.href = `/${locale}/dashboard`;
        return;
      }

      setEmailSent(true);
      startCooldown();
    } catch (error) {
      setError(
        isEmailAlreadyRegistered(error)
          ? t("errors.emailAlreadyRegistered")
          : t("errors.emailInUse")
      );
      setIsLoading(false);
    }
  };

  // 邮箱验证提示
  if (emailSent) {
    return (
      <div className="w-full space-y-6">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-foreground">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="font-serif text-2xl font-medium tracking-tight">
            {t("verifyEmail.title")}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("verifyEmail.description", { email })}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("verifyEmail.hint")}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleResendEmail}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0
              ? t("verifyEmail.resendCooldown", { seconds: resendCooldown })
              : t("verifyEmail.resend")}
          </Button>
          <Link
            href={`/${locale}/sign-in`}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors duration-150"
          >
            {t("verifyEmail.backToSignIn")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {/* Logo 和标题 */}
      <div className="flex flex-col items-center space-y-2 text-center">
        <AuthLogo />
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      {/* 错误提示 */}
      <AuthErrorAlert message={error} />

      {googleAuthEnabled ? (
        <>
          {/* OAuth 登录按钮 */}
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignUp}
              disabled={isLoading}
            >
              <GoogleIcon className="mr-2 h-4 w-4" />
              {tCommon("google")}
            </Button>
          </div>

          {/* 分隔线 */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-widest">
              {/* 遮线背景取卡片色:表单位于 bg-card 容器内 */}
              <span className="bg-card px-2 text-muted-foreground">
                {tCommon("or")}
              </span>
            </div>
          </div>
        </>
      ) : null}

      {/* 邮箱密码表单 */}
      <form onSubmit={handleEmailSignUp} className="space-y-4">
        {/* 姓名输入 */}
        <div className="space-y-2">
          <Label htmlFor="name">{t("nameLabel")}</Label>
          <Input
            id="name"
            type="text"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
            autoComplete="name"
          />
        </div>

        {/* 邮箱输入 */}
        <div className="space-y-2">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="email"
            aria-invalid={showEmailDomainError}
          />
          <p className="text-xs text-muted-foreground">
            {t("emailDomainHint", { domains: allowedEmailDomains })}
          </p>
          {showEmailDomainError ? (
            <p className="text-xs text-destructive">{emailDomainError}</p>
          ) : null}
        </div>

        {/* 验证码输入 */}
        <div className="space-y-2">
          <Label htmlFor="verificationCode">
            {t("verificationCode.label")}
          </Label>
          <div className="flex gap-2">
            <Input
              id="verificationCode"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder={t("verificationCode.placeholder")}
              value={verificationCode}
              onChange={(e) =>
                setVerificationCode(e.target.value.replace(/\D/g, ""))
              }
              disabled={isLoading}
              autoComplete="one-time-code"
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleSendCode}
              disabled={isLoading || isSendingCode || codeCooldown > 0}
              className="shrink-0"
            >
              {codeCooldown > 0
                ? t("verificationCode.cooldown", { seconds: codeCooldown })
                : isSendingCode
                  ? t("verificationCode.sending")
                  : t("verificationCode.send")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("verificationCode.hint")}
          </p>
        </div>

        {/* 密码输入 */}
        <div className="space-y-2">
          <Label htmlFor="password">{t("passwordLabel")}</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder={t("passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="new-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150"
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

        {/* 确认密码输入 */}
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("confirmPasswordLabel")}</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            placeholder={t("confirmPasswordPlaceholder")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
          />
        </div>

        {/* 提交按钮 */}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? t("loading") : t("submit")}
        </Button>
      </form>

      {/* 登录链接 */}
      <p className="text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          href={`/${locale}/sign-in`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("signInLink")}
        </Link>
      </p>
    </div>
  );
}
