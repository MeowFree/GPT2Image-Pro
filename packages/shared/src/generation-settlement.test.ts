import { describe, expect, it } from "vitest";

import {
  getFailedGenerationTargetCredits,
  getFailedGenerationTargetCreditsFromMetadata,
} from "./generation-settlement";

describe("failed generation settlement", () => {
  it("keeps only moderation costs for non-moderation generation failures", () => {
    for (const reason of [
      "generation_error",
      "storage_error",
      "settlement_error",
    ] as const) {
      expect(
        getFailedGenerationTargetCredits({
          reason,
          moderationFailureCredits: 1.31,
          moderationOnlyCredits: 0.04,
        })
      ).toBe(0.04);
    }
  });

  it("uses moderation failure policy only for moderation blocks", () => {
    expect(
      getFailedGenerationTargetCredits({
        reason: "moderation_block",
        moderationFailureCredits: 1.31,
        moderationOnlyCredits: 0.04,
      })
    ).toBe(1.31);
  });

  it("does not charge when moderation service fails before completing moderation", () => {
    expect(
      getFailedGenerationTargetCredits({
        reason: "moderation_error",
        moderationFailureCredits: 1.31,
        moderationOnlyCredits: 0.04,
      })
    ).toBe(0);
  });

  it("reads moderation-only timeout settlement from generation metadata", () => {
    expect(
      getFailedGenerationTargetCreditsFromMetadata({
        reason: "generation_error",
        chargedCredits: 1.31,
        metadata: {
          moderationFailureCredits: 1.31,
          creditCost: {
            moderationOnlyCredits: 0.04,
          },
        },
      })
    ).toBe(0.04);
  });

  it("applies the billing multiplier to moderationCredits when moderationOnlyCredits is absent", () => {
    // 无 moderationOnlyCredits 时才会走 moderationCredits * multiplier 分支，
    // 真正验证乘数（0.04 * 2 = 0.08），而非被 moderationOnlyCredits 短路。
    expect(
      getFailedGenerationTargetCreditsFromMetadata({
        reason: "generation_error",
        chargedCredits: 3,
        metadata: {
          billingMultiplier: 2,
          moderationFailureCredits: 3,
          creditCost: {
            moderationCredits: 0.04,
          },
        },
      })
    ).toBe(0.08);
  });

  it("keeps the full moderation failure charge for moderation_block, capped by chargedCredits", () => {
    expect(
      getFailedGenerationTargetCreditsFromMetadata({
        reason: "moderation_block",
        chargedCredits: 5,
        metadata: { moderationFailureCredits: 1.31 },
      })
    ).toBe(1.31);
  });

  it("caps the moderation_block charge at chargedCredits", () => {
    // moderationFailureCredits 高于实际已扣时，外层 Math.min 钳到 chargedCredits。
    expect(
      getFailedGenerationTargetCreditsFromMetadata({
        reason: "moderation_block",
        chargedCredits: 0.5,
        metadata: { moderationFailureCredits: 1.31 },
      })
    ).toBe(0.5);
  });

  it("keeps old timeout rows compatible when metadata has no cost breakdown", () => {
    expect(
      getFailedGenerationTargetCreditsFromMetadata({
        reason: "generation_error",
        chargedCredits: 1.31,
        metadata: {},
      })
    ).toBe(1.31);
  });
});
