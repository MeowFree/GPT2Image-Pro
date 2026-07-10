import { getServerSession } from "@repo/shared/auth/server";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getAppTimeZone } from "@repo/shared/time-zone/server";

import { ExternalApiKeySection } from "@/features/settings/components";

export const metadata = {
  title: "External API | GPT2IMAGE",
  description: "Create and manage GPT2IMAGE external API keys",
};

export default async function ExternalApiPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const [t, timeZone] = await Promise.all([
    getTranslations("Settings.externalApi"),
    getAppTimeZone(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <ExternalApiKeySection timeZone={timeZone} />
    </div>
  );
}
