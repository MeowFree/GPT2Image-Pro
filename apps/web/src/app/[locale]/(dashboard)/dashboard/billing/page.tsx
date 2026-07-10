import { getServerSession } from "@repo/shared/auth/server";
import { CreditUsageSection } from "@repo/shared/credits/components";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getAppTimeZone } from "@repo/shared/time-zone/server";

import { BillingSection } from "@/features/settings/components/billing-section";

export const metadata = {
  title: "Billing & Usage | GPT2IMAGE",
  description: "Manage subscriptions, billing history, and credit usage",
};

/** Tab 触发器统一样式：与设置页一致的单色边框激活态 + 150ms 颜色过渡 */
const tabTriggerClass =
  "rounded-md border border-transparent px-4 py-2 transition-colors duration-150 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none";

/** Tab 内容区入场：切换 tab 时淡入，尊重系统减少动态偏好 */
const tabContentClass =
  "mt-6 animate-in fade-in duration-300 motion-reduce:animate-none";

export default async function BillingPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const [t, tTabs, timeZone] = await Promise.all([
    getTranslations("Settings.billing"),
    getTranslations("Settings.billing.tabs"),
    getAppTimeZone(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium tracking-tight">
          {t("pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <Tabs defaultValue="billing" className="w-full">
        <div className="border-b border-border/60 pb-2">
          <TabsList className="h-auto gap-1 bg-transparent p-0">
            <TabsTrigger value="billing" className={tabTriggerClass}>
              {tTabs("billing")}
            </TabsTrigger>
            <TabsTrigger value="usage" className={tabTriggerClass}>
              {tTabs("usage")}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="billing" className={tabContentClass}>
          <BillingSection timeZone={timeZone} />
        </TabsContent>
        <TabsContent value="usage" className={tabContentClass}>
          <CreditUsageSection timeZone={timeZone} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
