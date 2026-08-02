import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, string | boolean>());

vi.mock("../system-settings", () => ({
  getRuntimeSettingString: vi.fn(async (key: string) => {
    const value = settings.get(key);
    return typeof value === "string" ? value : undefined;
  }),
  getRuntimeSettingBoolean: vi.fn(async (key: string, fallback: boolean) => {
    const value = settings.get(key);
    return typeof value === "boolean" ? value : fallback;
  }),
}));

import { getRuntimeRegistrationEmailPolicy } from "./registration-email-policy";

describe("getRuntimeRegistrationEmailPolicy", () => {
  beforeEach(() => {
    settings.clear();
  });

  it("uses the existing whitelist and permissive alias defaults", async () => {
    await expect(getRuntimeRegistrationEmailPolicy()).resolves.toEqual({
      allowedDomains: ["163.com", "126.com", "qq.com", "gmail.com"],
      blockPlusAliases: false,
      blockDottedLocalParts: false,
    });
  });

  it("loads a custom whitelist and both blocking switches", async () => {
    settings.set(
      "REGISTRATION_EMAIL_ALLOWED_DOMAINS",
      "outlook.com, example.org"
    );
    settings.set("REGISTRATION_EMAIL_BLOCK_PLUS_ALIASES", true);
    settings.set("REGISTRATION_EMAIL_BLOCK_DOTTED_LOCAL_PARTS", true);

    await expect(getRuntimeRegistrationEmailPolicy()).resolves.toEqual({
      allowedDomains: ["outlook.com", "example.org"],
      blockPlusAliases: true,
      blockDottedLocalParts: true,
    });
  });
});
