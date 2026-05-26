import { getCurrentUser } from "@repo/shared/auth/server";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

import { SystemDocsContent } from "@/features/docs/system-docs";

export default async function BackendHelpPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/${locale}/sign-in`);
  }

  return <SystemDocsContent locale={locale} />;
}
