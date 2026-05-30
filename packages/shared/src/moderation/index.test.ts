import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// moderation/index.ts 通过 '../system-settings'（→ @repo/database）读取运行时配置，
// 这里用 vi.mock 把配置层替换为可控的内存实现，使整套编排可在 DB-free 下单测。
// 与 subscription/services/plan-capabilities.test.ts 的隔离手法一致。

const runtimeSettingsMock = vi.hoisted(() => {
  const stringValues = new Map<string, string>();
  const booleanValues = new Map<string, boolean>();

  return {
    stringValues,
    booleanValues,
    getRuntimeSettingString: vi.fn(async (key: string) =>
      stringValues.get(key)
    ),
    getRuntimeSettingBoolean: vi.fn(
      async (key: string, fallback: boolean) =>
        booleanValues.has(key) ? booleanValues.get(key) : fallback
    ),
    getRuntimeSettingNumber: vi.fn(
      async (_key: string, fallback: number) => fallback
    ),
  };
});

const loggerMock = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../system-settings", () => runtimeSettingsMock);
vi.mock("../logger", () => loggerMock);

import {
  getConfiguredModerationProviders,
  moderateContent,
} from "./index";

const PROXY_URL = "https://moderation.example.com/check";

beforeEach(() => {
  runtimeSettingsMock.stringValues.clear();
  runtimeSettingsMock.booleanValues.clear();
  runtimeSettingsMock.getRuntimeSettingString.mockClear();
  runtimeSettingsMock.getRuntimeSettingBoolean.mockClear();
  runtimeSettingsMock.getRuntimeSettingNumber.mockClear();
  loggerMock.logError.mockClear();
  loggerMock.logWarn.mockClear();
  // 防止 getOpenAiApiKey 读到环境变量误判 openai 已配置。
  delete process.env.MODERATION_OPENAI_API_KEY;
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getConfiguredModerationProviders", () => {
  it("returns an empty list when moderation is disabled", async () => {
    runtimeSettingsMock.booleanValues.set("CONTENT_MODERATION_ENABLED", false);

    await expect(getConfiguredModerationProviders()).resolves.toEqual([]);
  });

  it("returns empty when the selected provider lacks credentials", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROVIDER",
      "openai"
    );

    await expect(getConfiguredModerationProviders()).resolves.toEqual([]);
  });

  it("returns the selected provider when its credentials are present", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROVIDER",
      "openai"
    );
    runtimeSettingsMock.stringValues.set(
      "OPENAI_MODERATION_API_KEY",
      "sk-test"
    );

    await expect(getConfiguredModerationProviders()).resolves.toEqual([
      "openai",
    ]);
  });

  it("auto-detects both providers when all credentials are present", async () => {
    runtimeSettingsMock.stringValues.set(
      "ALIYUN_MODERATION_ACCESS_KEY_ID",
      "id"
    );
    runtimeSettingsMock.stringValues.set(
      "ALIYUN_MODERATION_ACCESS_KEY_SECRET",
      "secret"
    );
    runtimeSettingsMock.stringValues.set(
      "OPENAI_MODERATION_API_KEY",
      "sk-test"
    );

    await expect(getConfiguredModerationProviders()).resolves.toEqual([
      "aliyun",
      "openai",
    ]);
  });

  it("returns empty when provider is explicitly set to none", async () => {
    runtimeSettingsMock.stringValues.set("CONTENT_MODERATION_PROVIDER", "none");

    await expect(getConfiguredModerationProviders()).resolves.toEqual([]);
  });
});

describe("moderateContent orchestration", () => {
  it("skips when moderation is disabled", async () => {
    runtimeSettingsMock.booleanValues.set("CONTENT_MODERATION_ENABLED", false);

    await expect(moderateContent({ prompt: "hi" })).resolves.toEqual({
      decision: "skipped",
    });
  });

  it("skips when no provider and no proxy are configured", async () => {
    await expect(moderateContent({ prompt: "hi" })).resolves.toEqual({
      decision: "skipped",
    });
  });

  it("returns the proxy block decision and short-circuits providers", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        decision: "block",
        provider: "openai",
        reason: "blocked",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(moderateContent({ prompt: "bad" })).resolves.toMatchObject({
      decision: "block",
      reason: "blocked",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed to error when only the proxy is configured and it throws", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(result.reason).toContain("connection refused");
    expect(loggerMock.logError).toHaveBeenCalledOnce();
  });

  it("fails open to allow with a warning when fail-closed is disabled", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    runtimeSettingsMock.booleanValues.set(
      "CONTENT_MODERATION_FAIL_CLOSED",
      false
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("allow");
    expect(loggerMock.logWarn).toHaveBeenCalledOnce();
  });

  it("fails closed to error on a non-ok proxy response", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(result.reason).toContain("502");
  });

  it("fails closed to error when the proxy returns an invalid decision", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ decision: "maybe" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await moderateContent({ prompt: "hi" });

    expect(result.decision).toBe("error");
    expect(result.reason).toContain("invalid decision");
  });

  it("sends the configured proxy secret on both auth headers", async () => {
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_URL",
      PROXY_URL
    );
    runtimeSettingsMock.stringValues.set(
      "CONTENT_MODERATION_PROXY_SECRET",
      "top-secret"
    );
    const fetchMock = vi.fn(
      async (_url: string, _init: { headers: Record<string, string> }) => ({
        ok: true,
        json: async () => ({ decision: "allow" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await moderateContent({ prompt: "hi" });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers.authorization).toBe("Bearer top-secret");
    expect(init?.headers["x-moderation-proxy-secret"]).toBe("top-secret");
  });
});
