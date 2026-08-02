import {
  DEFAULT_PLAN_CAPABILITY_MATRIX,
  type PlanCapabilityMatrix,
} from "@repo/shared/subscription/services/plan-capabilities";
import { describe, expect, it, vi } from "vitest";

import { buildPlanPresentation } from "./plan-presentation";

vi.hoisted(() => {
  process.env.DATABASE_URL ||=
    "postgresql://test:test@127.0.0.1:5432/gpt2image_test";
});

function matrix(): PlanCapabilityMatrix {
  return structuredClone(DEFAULT_PLAN_CAPABILITY_MATRIX);
}

describe("buildPlanPresentation", () => {
  it("uses runtime limits and capability thresholds", () => {
    const capabilityMatrix = matrix();
    capabilityMatrix.limits.starter.monthlyCredits = 5_123;
    capabilityMatrix.limits.starter.maxBatchCount = 100;
    capabilityMatrix.limits.starter.imageGenerationConcurrency = 15;
    capabilityMatrix.features["imageGeneration.chat"] = "starter";

    const result = buildPlanPresentation({
      planId: "starter",
      capabilityMatrix,
      imageRetentionPolicy: {
        mode: "count",
        retentionHours: 0,
        maxCount: 10_001,
      },
      locale: "zh-CN",
    });

    expect(result.monthlyCredits).toBe(5_123);
    expect(result.description).toContain("每月 5,123 积分");
    expect(result.description).toContain("对话创作");
    expect(result.features).toContain("批量生成最多 100 张图");
    expect(result.features).toContain("普通队列，最多 15 并发");
    expect(result.features).toContain(
      "每位用户最多保存最新 10,001 张生成图片，超出后自动删除最早图片"
    );
  });

  it("does not advertise capabilities below their configured plan", () => {
    const result = buildPlanPresentation({
      planId: "starter",
      capabilityMatrix: matrix(),
      imageRetentionPolicy: {
        mode: "off",
        retentionHours: 0,
        maxCount: 10_000,
      },
      locale: "en-US",
    });

    expect(result.description).not.toContain("Chat creation");
    expect(
      result.features.some((feature) => feature.includes("Responses"))
    ).toBe(false);
    expect(result.features).toContain(
      "Generated image files are saved permanently in the gallery"
    );
  });
});
