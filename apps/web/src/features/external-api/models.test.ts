import { describe, expect, it } from "vitest";

import type { SubscriptionPlan } from "@repo/shared/config/subscription-plan";

// models.ts 经 plan-capabilities → system-settings 间接 import @repo/database，
// 后者在模块加载时要求 DATABASE_URL；先注入占位再动态 import（不会真正连库）。
async function loadModels() {
  process.env.DATABASE_URL ||=
    "postgres://test:test@127.0.0.1:5432/gpt2image_test";
  const [models, config] = await Promise.all([
    import("./models"),
    import("@repo/shared/config/subscription-plan"),
  ]);
  return { ...models, GPT55_CHAT_MODEL: config.GPT55_CHAT_MODEL };
}

describe("getExternalResponsesImageModels", () => {
  it("returns an empty list when the responses capability is disabled", async () => {
    const { getExternalResponsesImageModels } = await loadModels();
    expect(
      getExternalResponsesImageModels("ultra", { responsesAllowed: false })
    ).toEqual([]);
  });

  it("includes gpt-5.5 only for ultra and above by default", async () => {
    const { getExternalResponsesImageModels, GPT55_CHAT_MODEL } =
      await loadModels();
    for (const plan of ["free", "starter", "pro"] as SubscriptionPlan[]) {
      expect(getExternalResponsesImageModels(plan)).not.toContain(
        GPT55_CHAT_MODEL
      );
    }
    for (const plan of ["ultra", "enterprise"] as SubscriptionPlan[]) {
      expect(getExternalResponsesImageModels(plan)).toContain(GPT55_CHAT_MODEL);
    }
  });

  it("honors an explicit gpt55Allowed override", async () => {
    const { getExternalResponsesImageModels, GPT55_CHAT_MODEL } =
      await loadModels();
    expect(
      getExternalResponsesImageModels("pro", { gpt55Allowed: true })
    ).toContain(GPT55_CHAT_MODEL);
    expect(
      getExternalResponsesImageModels("ultra", { gpt55Allowed: false })
    ).not.toContain(GPT55_CHAT_MODEL);
  });
});

describe("getExternalFireflyModels", () => {
  it("returns an empty list when image generation is disabled", async () => {
    const { getExternalFireflyModels } = await loadModels();
    expect(getExternalFireflyModels({ imageGenerateAllowed: false })).toEqual(
      []
    );
    expect(getExternalFireflyModels()).toEqual([]);
  });

  it("includes firefly image family ids and full video ids when allowed", async () => {
    const { getExternalFireflyModels } = await loadModels();
    const models = getExternalFireflyModels({ imageGenerateAllowed: true });
    // 图像族级 id。
    expect(models).toContain("firefly-gpt-image-2");
    expect(models).toContain("firefly-nano-banana-pro");
    // 视频全量 id(参数编码在 id 内)。
    expect(models).toContain("firefly-sora2-8s-16x9");
    // 不应混入分辨率/宽高比展开的图像全组合(图像只列族级)。
    expect(models).not.toContain("firefly-gpt-image-2-2k-1x1");
    expect(models.length).toBeGreaterThan(10);
  });
});

describe("getExternalChatCompletionModels", () => {
  it("returns an empty list when chat completions are disabled", async () => {
    const { getExternalChatCompletionModels } = await loadModels();
    expect(
      getExternalChatCompletionModels("ultra", {
        chatCompletionsAllowed: false,
      })
    ).toEqual([]);
  });

  it("reuses the responses model set when allowed", async () => {
    const { getExternalChatCompletionModels, getExternalResponsesImageModels } =
      await loadModels();
    expect(
      getExternalChatCompletionModels("ultra", { gpt55Allowed: true })
    ).toEqual(
      getExternalResponsesImageModels("ultra", {
        responsesAllowed: true,
        gpt55Allowed: true,
      })
    );
  });
});
