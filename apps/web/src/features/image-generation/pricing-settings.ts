import { getRuntimeSettingNumber } from "@repo/shared/system-settings";

import {
  DEFAULT_IMAGE_1024_BASE_CREDIT_COST,
  DEFAULT_IMAGE_4K_BASE_CREDIT_COST,
  type ImageBaseCreditPricing,
} from "./resolution";

export async function getRuntimeImageBaseCreditPricing(): Promise<ImageBaseCreditPricing> {
  const [base1024Credits, base4kCredits] = await Promise.all([
    getRuntimeSettingNumber(
      "IMAGE_BASE_CREDITS_1024",
      DEFAULT_IMAGE_1024_BASE_CREDIT_COST,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_BASE_CREDITS_4K",
      DEFAULT_IMAGE_4K_BASE_CREDIT_COST,
      { positive: true }
    ),
  ]);

  return { base1024Credits, base4kCredits };
}
