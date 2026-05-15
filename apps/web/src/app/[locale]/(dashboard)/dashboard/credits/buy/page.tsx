import type { Metadata } from "next";
import { Suspense } from "react";

import { BuyCreditPackagesView } from "./buy-credits-view";

export const metadata: Metadata = {
  title: "Buy Credits",
  description: "Purchase credit packages for GPT2IMAGE",
};

/**
 * 购买积分页面
 *
 * 展示积分套餐供用户选择并购买
 */
export default function BuyCreditsPage() {
  return (
    <Suspense fallback={null}>
      <BuyCreditPackagesView />
    </Suspense>
  );
}
