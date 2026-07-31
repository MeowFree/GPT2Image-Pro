import {
  getRuntimePaymentConfig,
  getSubscriptionMonthlyCredits,
} from "@repo/shared/config/payment-runtime";
import { getServerSession } from "@repo/shared/auth/server";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

import { BuySubscriptionView } from "./buy-subscription-view";

export const metadata = {
  title: "Choose a Plan | GPT2IMAGE",
  description: "Purchase or upgrade your GPT2IMAGE subscription",
};

export default async function BuySubscriptionPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user?.id) {
    redirect(`/${locale}/sign-in`);
  }

  const [payment, userPlan, monthlyCredits] = await Promise.all([
    getRuntimePaymentConfig(),
    getUserPlan(session.user.id),
    getSubscriptionMonthlyCredits(),
  ]);

  return (
    <BuySubscriptionView
      payment={payment}
      currentPlan={{
        plan: userPlan.plan,
        priceId: userPlan.priceId,
        hasActiveSubscription: userPlan.hasActiveSubscription,
        cancelAtPeriodEnd: userPlan.cancelAtPeriodEnd,
      }}
      monthlyCredits={monthlyCredits}
    />
  );
}
