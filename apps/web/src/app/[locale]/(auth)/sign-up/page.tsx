import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { isRegistrationFixedCodeEnabled } from "@repo/shared/auth/registration-fixed-code";
import { getRuntimeRegistrationEmailPolicy } from "@repo/shared/auth/registration-email-policy";
import { isSelfUseModeEnabled } from "@repo/shared/auth/self-use-mode";
import { redirect } from "next/navigation";

function isGoogleAuthEnabled() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

/**
 * 注册页面
 * 路由: /sign-up
 */
export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (await isSelfUseModeEnabled()) {
    const { locale } = await params;
    redirect(`/${locale}/sign-in`);
  }

  return (
    <SignUpForm
      googleAuthEnabled={isGoogleAuthEnabled()}
      fixedVerificationCodeEnabled={await isRegistrationFixedCodeEnabled()}
      registrationEmailPolicy={await getRuntimeRegistrationEmailPolicy()}
    />
  );
}
