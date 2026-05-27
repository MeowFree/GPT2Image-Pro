import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({
  db: {},
}));

vi.mock("@repo/database/schema", () => ({
  systemSetting: {
    key: "key",
    value: "value",
  },
}));

import { shouldSyncSettingToEnvFile } from "./env-file";

describe("system settings env file sync", () => {
  it("only writes public settings and explicitly managed internal keys", () => {
    expect(shouldSyncSettingToEnvFile("NEXT_PUBLIC_APP_URL")).toBe(true);
    expect(shouldSyncSettingToEnvFile("SUB2API_AUTO_SYNC_TASKS")).toBe(true);

    expect(shouldSyncSettingToEnvFile("__internal_job_scheduler:sub2api-sync")).toBe(
      false
    );
    expect(shouldSyncSettingToEnvFile("SUB2API_AUTO_SYNC_INTERVAL_MINUTES")).toBe(
      false
    );
  });
});
