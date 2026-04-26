import { redirect } from "next/navigation";

import { getCreditsBalance } from "@repo/shared/credits/core";
import { CreatePageClient } from "@/features/image-generation/components/create-page-client";
import { getUserRecentGenerations } from "@/features/image-generation/queries";
import { getCurrentUser } from "@repo/shared/auth/server";

export default async function CreatePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const [creditsData, recentGenerations] = await Promise.all([
    getCreditsBalance(user.id),
    getUserRecentGenerations(user.id, 6),
  ]);

  const balance = creditsData?.balance || 0;
  const creditsPerImage = Number(process.env.CREDITS_PER_IMAGE) || 1;

  const recents = recentGenerations.map((g) => ({
    id: g.id,
    prompt: g.prompt,
    imageUrl: g.storageKey
      ? process.env.STORAGE_ENDPOINT
        ? `/image-proxy/${g.storageBucket}/${g.storageKey}`
        : `/api/storage/${g.storageBucket}/${g.storageKey}`
      : null,
    createdAt: g.createdAt.toISOString(),
  }));

  return (
    <CreatePageClient
      balance={balance}
      creditsPerImage={creditsPerImage}
      recentGenerations={recents}
    />
  );
}
