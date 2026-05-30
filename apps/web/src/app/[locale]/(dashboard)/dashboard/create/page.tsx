import { getCurrentUser } from "@repo/shared/auth/server";

import { getCreditsBalance } from "@repo/shared/credits/core";
import { isContentModerationEnabled } from "@repo/shared/moderation";
import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getPlanUploadLimits } from "@repo/shared/subscription/services/upload-limits";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { getAppTimeZone } from "@repo/shared/time-zone/server";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { CreatePageClient } from "@/features/image-generation/components/create-page-client";
import { toStoredImageUrl } from "@/features/image-generation/generation-metadata";
import { getRuntimeImageBaseCreditPricing } from "@/features/image-generation/pricing-settings";
import { getUserRecentGenerations } from "@/features/image-generation/queries";
import { getUserApiConfig } from "@/features/image-generation/service";
import {
  getUserImageBackendPreference,
  listSelectableImageBackendGroups,
} from "@/features/image-backend-pool/service";

export default async function CreatePage() {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/sign-in`);

  const [creditsData, recentGenerations, plan, userApiConfig, timeZone] =
    await Promise.all([
      getCreditsBalance(user.id),
      getUserRecentGenerations(user.id, 6),
      getUserPlan(user.id),
      getUserApiConfig(user.id),
      getAppTimeZone(),
    ]);
  const [
    uploadLimits,
    backendGroups,
    selectedBackendGroupId,
    moderationEnabled,
  ] = await Promise.all([
    getPlanUploadLimits(plan.plan),
    listSelectableImageBackendGroups(plan.plan),
    getUserImageBackendPreference(user.id, plan.plan),
    isContentModerationEnabled(),
  ]);
  const [capabilities, imageBasePricing] = await Promise.all([
    getPlanCapabilitySnapshot(plan.plan),
    getRuntimeImageBaseCreditPricing(),
  ]);

  const balance = creditsData?.balance || 0;

  const recents = recentGenerations.map((g) => ({
    id: g.id,
    prompt: g.prompt,
    revisedPrompt: g.revisedPrompt,
    model: g.model,
    size: g.size,
    creditsConsumed: g.creditsConsumed,
    status: g.status,
    imageUrl: toStoredImageUrl(g.storageBucket, g.storageKey),
    createdAt: g.createdAt.toISOString(),
  }));

  return (
    <CreatePageClient
      balance={balance}
      recentGenerations={recents}
      plan={plan.plan}
      capabilities={capabilities}
      uploadLimits={uploadLimits}
      backendGroups={backendGroups.map((group) => ({
        id: group.id,
        name: group.name,
        isDefault: group.isDefault,
        backendType: group.backendType,
        contentSafetyEnabled: group.contentSafetyEnabled,
        billingMultiplier: group.billingMultiplier,
      }))}
      selectedBackendGroupId={selectedBackendGroupId}
      customApiActive={Boolean(userApiConfig)}
      moderationEnabled={moderationEnabled}
      imageBasePricing={imageBasePricing}
      timeZone={timeZone}
    />
  );
}
