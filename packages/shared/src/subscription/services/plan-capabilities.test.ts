import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_RANK, SUBSCRIPTION_PLANS } from "../../config/subscription-plan";
import { SYSTEM_SETTING_DEFINITIONS } from "../../system-settings/definitions";
import {
  DEFAULT_PLAN_CAPABILITY_MATRIX,
  PLAN_CAPABILITY_KEYS,
  canUsePlanCapability,
  getAllowedPlanModerationBlockRiskLevels,
  getPlanCapabilityMatrix,
  getPlanCapabilitySnapshot,
  getPlanLimits,
  getPlanMonthlyCredits,
  getPlanQueueSettings,
  megabytesToBytes,
  normalizePlanCapabilityMatrix,
  normalizePlanModerationBlockRiskLevel,
  type PlanLimitConfig,
} from "./plan-capabilities";

const runtimeSettingsMock = vi.hoisted(() => ({
  getRuntimeSettingJson: vi.fn(),
  getRuntimeSettingNumber: vi.fn(),
}));

vi.mock("../../system-settings", () => runtimeSettingsMock);

const higherThan = (plan: (typeof SUBSCRIPTION_PLANS)[number]) =>
  SUBSCRIPTION_PLANS.filter((candidate) => PLAN_RANK[candidate] > PLAN_RANK[plan]);

describe("plan capability matrix defaults", () => {
  beforeEach(() => {
    runtimeSettingsMock.getRuntimeSettingJson.mockReset();
    runtimeSettingsMock.getRuntimeSettingNumber.mockReset();
  });

  it("normalizes an empty value to the complete default matrix", () => {
    const matrix = normalizePlanCapabilityMatrix(undefined);

    expect(matrix).toEqual(DEFAULT_PLAN_CAPABILITY_MATRIX);
    expect(Object.keys(matrix.features).sort()).toEqual(
      [...PLAN_CAPABILITY_KEYS].sort()
    );
    expect(matrix.features["externalApi.streaming"]).toBe("starter");
    expect(matrix.features["externalApi.responses"]).toBe("pro");
    expect(matrix.features["imageGeneration.chat"]).toBe("pro");
    expect(matrix.features["moderation.onlyFailureSettlement"]).toBe("ultra");
    expect(matrix.limits.ultra).toMatchObject({
      maxFileMb: 100,
      maxUploadMb: 100,
      imageGenerationConcurrency: 50,
      monthlyCredits: 80_000,
      queuePriority: "highest",
    });
    expect(matrix.limits.enterprise.monthlyCredits).toBe(320_000);
  });

  it("keeps the system settings example in sync with every matrix field", () => {
    const setting = SYSTEM_SETTING_DEFINITIONS.find(
      (definition) => definition.key === "PLAN_CAPABILITY_MATRIX"
    );

    expect(setting?.exampleValue).toEqual(DEFAULT_PLAN_CAPABILITY_MATRIX);
  });

  it("accepts custom feature thresholds and ignores invalid capability values", () => {
    const matrix = normalizePlanCapabilityMatrix({
      features: {
        "externalApi.streaming": "ultra",
        "promptOptimization.control": "free",
        "imageGeneration.chat": "starter",
        "externalApi.responses": "not-a-plan",
        "unknown.feature": "enterprise",
      },
    });

    expect(matrix.features["externalApi.streaming"]).toBe("ultra");
    expect(matrix.features["promptOptimization.control"]).toBe("free");
    expect(matrix.features["imageGeneration.chat"]).toBe("starter");
    expect(matrix.features["externalApi.responses"]).toBe(
      DEFAULT_PLAN_CAPABILITY_MATRIX.features["externalApi.responses"]
    );
    expect(Object.keys(matrix.features).sort()).toEqual(
      [...PLAN_CAPABILITY_KEYS].sort()
    );
  });

  it("merges partial limits with defaults and preserves Ultra-specific settings", () => {
    const matrix = normalizePlanCapabilityMatrix({
      limits: {
        ultra: {
          maxFileMb: 150,
          maxUploadMb: 300,
          queuePriority: "highest",
          imageGenerationConcurrency: 88,
          monthlyCredits: 123_456,
          maxBatchCount: 20,
          maxEditImages: 32,
          maxChatImages: 24,
          maxChatContextChars: 99_999,
        },
      },
    });

    expect(matrix.limits.pro).toEqual(DEFAULT_PLAN_CAPABILITY_MATRIX.limits.pro);
    expect(matrix.limits.ultra).toMatchObject({
      maxFileMb: 150,
      maxUploadMb: 300,
      queuePriority: "highest",
      imageGenerationConcurrency: 88,
      monthlyCredits: 123_456,
      maxBatchCount: 20,
      maxEditImages: 32,
      maxChatImages: 24,
      maxChatContextChars: 99_999,
    });
    expect(matrix.limits.enterprise).toMatchObject({
      maxUploadMb: 300,
      maxBatchCount: 20,
      maxEditImages: 32,
      maxChatImages: 24,
      maxChatContextChars: 99_999,
    });
  });

  it("enforces higher plans to inherit at least lower-plan numeric limits", () => {
    const freeLimits: PlanLimitConfig = {
      maxFileMb: 500,
      maxUploadMb: 600,
      queuePriority: "highest",
      imageGenerationConcurrency: 25,
      monthlyCredits: 900_000,
      maxBatchCount: 42,
      maxEditImages: 41,
      maxChatImages: 40,
      maxChatContextChars: 150_000,
    };
    const matrix = normalizePlanCapabilityMatrix({
      limits: {
        free: freeLimits,
        starter: {
          maxFileMb: 1,
          maxUploadMb: 1,
          queuePriority: "normal",
          imageGenerationConcurrency: 1,
          monthlyCredits: 1,
          maxBatchCount: 1,
          maxEditImages: 1,
          maxChatImages: 1,
          maxChatContextChars: 1,
        },
      },
    });

    expect(matrix.limits.free).toEqual(freeLimits);
    for (const plan of higherThan("free")) {
      expect(matrix.limits[plan].maxFileMb).toBeGreaterThanOrEqual(500);
      expect(matrix.limits[plan].maxUploadMb).toBeGreaterThanOrEqual(600);
      expect(matrix.limits[plan].queuePriority).toBe("highest");
      expect(matrix.limits[plan].imageGenerationConcurrency).toBeGreaterThanOrEqual(
        25
      );
      expect(matrix.limits[plan].monthlyCredits).toBeGreaterThanOrEqual(900_000);
      expect(matrix.limits[plan].maxBatchCount).toBeGreaterThanOrEqual(42);
      expect(matrix.limits[plan].maxEditImages).toBeGreaterThanOrEqual(41);
      expect(matrix.limits[plan].maxChatImages).toBeGreaterThanOrEqual(40);
      expect(matrix.limits[plan].maxChatContextChars).toBeGreaterThanOrEqual(
        150_000
      );
    }
  });

  it("falls back for invalid limits and clamps bounded request counts", () => {
    const matrix = normalizePlanCapabilityMatrix({
      limits: {
        free: {
          maxFileMb: 0,
          maxUploadMb: -1,
          queuePriority: "urgent",
          imageGenerationConcurrency: 2_000,
          monthlyCredits: "invalid",
          maxBatchCount: 101.9,
          maxEditImages: 150,
          maxChatImages: "200",
          maxChatContextChars: 999_999,
        },
      },
    });

    expect(matrix.limits.free).toMatchObject({
      maxFileMb: DEFAULT_PLAN_CAPABILITY_MATRIX.limits.free.maxFileMb,
      maxUploadMb: DEFAULT_PLAN_CAPABILITY_MATRIX.limits.free.maxUploadMb,
      queuePriority: DEFAULT_PLAN_CAPABILITY_MATRIX.limits.free.queuePriority,
      imageGenerationConcurrency: 1_000,
      monthlyCredits: DEFAULT_PLAN_CAPABILITY_MATRIX.limits.free.monthlyCredits,
      maxBatchCount: 100,
      maxEditImages: 100,
      maxChatImages: 100,
      maxChatContextChars: 200_000,
    });
  });

  it("clamps moderation defaults and lets higher plans inherit lower-plan max levels", () => {
    const matrix = normalizePlanCapabilityMatrix({
      moderation: {
        free: {
          defaultBlockRiskLevel: "high",
          maxBlockRiskLevel: "medium",
        },
        starter: {
          defaultBlockRiskLevel: "invalid",
          maxBlockRiskLevel: "low",
        },
        pro: {
          defaultBlockRiskLevel: "low",
          maxBlockRiskLevel: "low",
        },
        ultra: {
          defaultBlockRiskLevel: "low",
          maxBlockRiskLevel: "low",
        },
        enterprise: {
          defaultBlockRiskLevel: "medium",
          maxBlockRiskLevel: "invalid",
        },
      },
    });

    expect(matrix.moderation.free).toEqual({
      defaultBlockRiskLevel: "medium",
      maxBlockRiskLevel: "medium",
    });
    for (const plan of ["starter", "pro", "ultra"] as const) {
      expect(matrix.moderation[plan].maxBlockRiskLevel).toBe("medium");
      expect(matrix.moderation[plan].defaultBlockRiskLevel).toBe("low");
    }
    expect(matrix.moderation.enterprise).toEqual({
      defaultBlockRiskLevel: "medium",
      maxBlockRiskLevel: "high",
    });
  });
});

describe("plan capability matrix runtime accessors", () => {
  beforeEach(() => {
    runtimeSettingsMock.getRuntimeSettingJson.mockReset();
    runtimeSettingsMock.getRuntimeSettingNumber.mockReset();
  });

  it("uses a configured matrix directly without reading legacy upload or credit settings", async () => {
    runtimeSettingsMock.getRuntimeSettingJson.mockResolvedValue({
      features: {
        "externalApi.streaming": "ultra",
      },
      limits: {
        free: {
          maxUploadMb: 11,
        },
      },
    });
    runtimeSettingsMock.getRuntimeSettingNumber.mockResolvedValue(999);

    const matrix = await getPlanCapabilityMatrix();

    expect(matrix.features["externalApi.streaming"]).toBe("ultra");
    expect(matrix.limits.free.maxUploadMb).toBe(11);
    expect(runtimeSettingsMock.getRuntimeSettingNumber).not.toHaveBeenCalled();
  });

  it("keeps legacy upload and monthly-credit settings compatible when no matrix is configured", async () => {
    runtimeSettingsMock.getRuntimeSettingJson.mockResolvedValue(undefined);
    runtimeSettingsMock.getRuntimeSettingNumber.mockImplementation(
      async (key: string, fallback: number) => {
        if (key === "PLAN_ULTRA_MAX_FILE_MB") return 111;
        if (key === "PLAN_ULTRA_MAX_UPLOAD_MB") return 222;
        if (key === "PLAN_PRO_MONTHLY_CREDITS") return 33_333;
        return fallback;
      }
    );

    const matrix = await getPlanCapabilityMatrix();

    expect(matrix.limits.pro.monthlyCredits).toBe(33_333);
    expect(matrix.limits.ultra.maxFileMb).toBe(111);
    expect(matrix.limits.ultra.maxUploadMb).toBe(222);
    expect(matrix.limits.enterprise.maxUploadMb).toBe(222);
    expect(runtimeSettingsMock.getRuntimeSettingNumber).toHaveBeenCalledTimes(14);
  });

  it("drives feature gates, limits, queue settings, snapshots, and moderation helpers", async () => {
    runtimeSettingsMock.getRuntimeSettingJson.mockResolvedValue({
      features: {
        "externalApi.streaming": "ultra",
        "imageGeneration.chat": "starter",
      },
      limits: {
        ultra: {
          maxFileMb: 150,
          maxUploadMb: 180,
          queuePriority: "highest",
          imageGenerationConcurrency: 77,
          monthlyCredits: 88_000,
          maxBatchCount: 22,
          maxEditImages: 33,
          maxChatImages: 44,
          maxChatContextChars: 55_000,
        },
      },
      moderation: {
        ultra: {
          defaultBlockRiskLevel: "medium",
          maxBlockRiskLevel: "medium",
        },
      },
    });

    await expect(
      canUsePlanCapability("pro", "externalApi.streaming")
    ).resolves.toBe(false);
    await expect(
      canUsePlanCapability("ultra", "externalApi.streaming")
    ).resolves.toBe(true);
    await expect(canUsePlanCapability("starter", "imageGeneration.chat")).resolves.toBe(
      true
    );

    await expect(getPlanLimits("ultra")).resolves.toMatchObject({
      maxFileMb: 150,
      maxUploadMb: 180,
      imageGenerationConcurrency: 77,
      monthlyCredits: 88_000,
    });
    await expect(getPlanMonthlyCredits("ultra")).resolves.toBe(88_000);
    await expect(getPlanQueueSettings("ultra")).resolves.toEqual({
      priority: "highest",
      userConcurrency: 77,
    });
    await expect(getAllowedPlanModerationBlockRiskLevels("ultra")).resolves.toEqual(
      ["low", "medium"]
    );
    await expect(normalizePlanModerationBlockRiskLevel("ultra", "high")).resolves.toBe(
      "medium"
    );

    const snapshot = await getPlanCapabilitySnapshot("ultra");
    expect(snapshot.features["externalApi.streaming"]).toBe(true);
    expect(snapshot.features["models.gpt55"]).toBe(true);
    expect(snapshot.limits.maxFileSizeBytes).toBe(megabytesToBytes(150));
    expect(snapshot.limits.maxUploadBytes).toBe(megabytesToBytes(180));
    expect(snapshot.moderation.allowedBlockRiskLevels).toEqual([
      "low",
      "medium",
    ]);
  });
});
