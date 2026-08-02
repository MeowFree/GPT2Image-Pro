import { getServerSession } from "@repo/shared/auth/server";
import { getRuntimePaymentConfig } from "@repo/shared/config/payment-runtime";
import { getPlanCapabilityMatrix } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getRuntimeImageRetentionPolicy } from "@/features/marketing/image-retention-policy-server";

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

  const [payment, userPlan, capabilityMatrix, imageRetentionPolicy] =
    await Promise.all([
      getRuntimePaymentConfig(),
      getUserPlan(session.user.id),
      getPlanCapabilityMatrix(),
      getRuntimeImageRetentionPolicy(),
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
      capabilityMatrix={capabilityMatrix}
      imageRetentionPolicy={imageRetentionPolicy}
    />
  );
}
