import { getCurrentUser } from "@repo/shared/auth/server";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

import { BackendDocs } from "@/features/docs/backend-docs";

export default async function BackendHelpPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/${locale}/sign-in`);
  }

  // 系统架构 + 外部 API 参考(合并版),与公开 /docs/system 同源。
  return <BackendDocs locale={locale} />;
}
