import "server-only";

import {
  getRuntimeSettingNumber,
  getRuntimeSettingSelect,
} from "@repo/shared/system-settings";

import {
  IMAGE_RETENTION_MODES,
  type ImageRetentionPolicy,
} from "./image-retention-policy";

export async function getRuntimeImageRetentionPolicy(): Promise<ImageRetentionPolicy> {
  const [mode, retentionHours, maxCount] = await Promise.all([
    getRuntimeSettingSelect(
      "GENERATION_IMAGE_RETENTION_MODE",
      IMAGE_RETENTION_MODES,
      "off"
    ),
    getRuntimeSettingNumber("GENERATION_IMAGE_RETENTION_HOURS", 0, {
      nonNegative: true,
    }),
    getRuntimeSettingNumber("GENERATION_IMAGE_MAX_COUNT", 10_000, {
      positive: true,
    }),
  ]);

  return { mode, retentionHours, maxCount };
}
