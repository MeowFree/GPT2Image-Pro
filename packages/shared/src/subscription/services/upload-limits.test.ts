import { beforeEach, describe, expect, it, vi } from "vitest";

import { SUBSCRIPTION_PLANS } from "../../config/subscription-plan";

// plan-capabilities 在导入时会经 system-settings 触达 @repo/database，
// 为保持 DB-free，这里整体 mock 该模块：getPlanLimits 由用例注入，
// megabytesToBytes 复刻真实实现（Math.floor(value * 1MB)）以保留字节换算契约。
const BYTES_PER_MB = 1024 * 1024;

const planCapabilitiesMock = vi.hoisted(() => ({
  getPlanLimits: vi.fn(),
}));

vi.mock("./plan-capabilities", () => ({
  getPlanLimits: planCapabilitiesMock.getPlanLimits,
  megabytesToBytes: (value: number) => Math.floor(value * 1024 * 1024),
}));

function megabytesToBytes(value: number) {
  return Math.floor(value * BYTES_PER_MB);
}

const limitsFor = (maxFileMb: number, maxUploadMb: number) => ({
  maxFileMb,
  maxUploadMb,
  queuePriority: "normal" as const,
  imageGenerationConcurrency: 1,
  monthlyCredits: 1,
  maxBatchCount: 1,
  maxEditImages: 1,
  maxChatImages: 1,
  maxChatContextChars: 1,
});

describe("getPlanUploadLimits", () => {
  beforeEach(() => {
    planCapabilitiesMock.getPlanLimits.mockReset();
  });

  it("converts plan MB limits to bytes via megabytesToBytes", async () => {
    planCapabilitiesMock.getPlanLimits.mockResolvedValue(limitsFor(20, 75));

    const { getPlanUploadLimits } = await import("./upload-limits");
    const limits = await getPlanUploadLimits("starter");

    expect(limits).toEqual({
      maxFileSizeBytes: megabytesToBytes(20),
      maxUploadBytes: megabytesToBytes(75),
    });
  });
});

describe("getAllPlanUploadLimits", () => {
  beforeEach(() => {
    planCapabilitiesMock.getPlanLimits.mockReset();
  });

  it("returns upload limits for every SUBSCRIPTION_PLANS entry", async () => {
    planCapabilitiesMock.getPlanLimits.mockImplementation(async () =>
      limitsFor(10, 30)
    );

    const { getAllPlanUploadLimits } = await import("./upload-limits");
    const all = await getAllPlanUploadLimits();

    // 键集合断言捕获硬编码套餐数组与 SUBSCRIPTION_PLANS 之间的漂移。
    expect(Object.keys(all).sort()).toEqual([...SUBSCRIPTION_PLANS].sort());
    for (const plan of SUBSCRIPTION_PLANS) {
      expect(all[plan]).toEqual({
        maxFileSizeBytes: megabytesToBytes(10),
        maxUploadBytes: megabytesToBytes(30),
      });
    }
  });
});
