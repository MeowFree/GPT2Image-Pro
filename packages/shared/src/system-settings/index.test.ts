import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSystemSettingsCache,
  getAdminSystemSettingsSnapshot,
  getRuntimeSettingBoolean,
  getRuntimeSettingJson,
  getRuntimeSettingSelect,
  getRuntimeSettingString,
  importSystemSettingsFromEnv,
  setSystemSettings,
} from "./index";

// DB-free 单测：用内存 store 模拟 systemSetting 表，覆盖 setSystemSettings
// 的写入主入口、coerceValue 校验门、importSystemSettingsFromEnv 的 overwrite
// 语义、getAdminSystemSettingsSnapshot 的密钥脱敏，以及运行时取值器的
// stored↔env 回退路径。所有逻辑不触达真实 @repo/database。

type StoredSetting = {
  key: string;
  value: unknown;
  isSecret?: boolean;
  updatedBy?: string | null;
  updatedAt?: Date | null;
};

const store = vi.hoisted(() => new Map<string, StoredSetting>());

// 记录最近一次 delete 命中的 key，用于校验 eq(key) 删除分支。
const deletedKeys = vi.hoisted(() => ({ value: [] as string[] }));

const dbMock = vi.hoisted(() => {
  const readRows = () =>
    [...store.values()].map((row) => ({
      key: row.key,
      value: row.value,
      isSecret: row.isSecret ?? false,
      updatedAt: row.updatedAt ?? null,
    }));

  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(async () => readRows()),
    then: vi.fn((resolve, reject) =>
      Promise.resolve(readRows()).then(resolve, reject)
    ),
  };

  // upsert 语义：onConflictDoUpdate 时覆盖既有行，模拟 setSystemSettings/
  // importSystemSettingsFromEnv 的写入；onConflictDoNothing 时仅插入缺失行。
  const makeInsertBuilder = () => {
    let pending: StoredSetting[] = [];
    const insertBuilder = {
      values: vi.fn((values: StoredSetting | StoredSetting[]) => {
        pending = Array.isArray(values) ? values : [values];
        for (const value of pending) {
          if (!store.has(value.key)) {
            store.set(value.key, { ...value });
          }
        }
        return insertBuilder;
      }),
      onConflictDoNothing: vi.fn(async () => undefined),
      onConflictDoUpdate: vi.fn(async () => {
        for (const value of pending) {
          store.set(value.key, { ...value });
        }
      }),
    };
    return insertBuilder;
  };

  const deleteBuilder = {
    where: vi.fn(async (target: unknown) => {
      // setSystemSettings 用 eq(key) 删除：mock 的 eq 返回 { key }。
      if (
        target &&
        typeof target === "object" &&
        "key" in target &&
        typeof (target as { key: unknown }).key === "string"
      ) {
        const key = (target as { key: string }).key;
        deletedKeys.value.push(key);
        store.delete(key);
        return;
      }
      // 迁移逻辑用 inArray(...)：mock 的 inArray 返回 key 数组。
      if (Array.isArray(target)) {
        for (const key of target) {
          store.delete(String(key));
        }
      }
    }),
  };

  return {
    select: vi.fn(() => selectBuilder),
    insert: vi.fn(() => makeInsertBuilder()),
    delete: vi.fn(() => deleteBuilder),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        insert: vi.fn(() => makeInsertBuilder()),
        delete: vi.fn(() => deleteBuilder),
      })
    ),
  };
});

vi.mock("@repo/database", () => ({
  db: dbMock,
}));

vi.mock("@repo/database/schema", () => ({
  systemSetting: {
    key: "key",
    value: "value",
    isSecret: "is_secret",
    updatedBy: "updated_by",
    updatedAt: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  // eq 返回 { 列: 值 }，便于 deleteBuilder 识别 key 删除分支。
  eq: vi.fn((field: unknown, value: unknown) => ({ [String(field)]: value })),
  inArray: vi.fn((_field: unknown, values: unknown[]) => values),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

describe("setSystemSettings", () => {
  beforeEach(() => {
    store.clear();
    deletedKeys.value = [];
    clearSystemSettingsCache();
  });

  it("rejects unknown setting key throwing 未知配置项", async () => {
    await expect(
      setSystemSettings([{ key: "NOT_A_REAL_KEY", value: "x" }], "admin")
    ).rejects.toThrow("未知配置项: NOT_A_REAL_KEY");
  });

  it("clear entry deletes stored setting", async () => {
    store.set("APP_TIME_ZONE", { key: "APP_TIME_ZONE", value: "Asia/Shanghai" });

    const changed = await setSystemSettings(
      [{ key: "APP_TIME_ZONE", value: "", clear: true }],
      "admin"
    );

    expect(changed).toEqual(["APP_TIME_ZONE"]);
    expect(store.has("APP_TIME_ZONE")).toBe(false);
    expect(deletedKeys.value).toContain("APP_TIME_ZONE");
  });

  it("skips blank secret to avoid wiping stored secret", async () => {
    store.set("BETTER_AUTH_SECRET", {
      key: "BETTER_AUTH_SECRET",
      value: "existing-secret",
      isSecret: true,
    });

    const changed = await setSystemSettings(
      [{ key: "BETTER_AUTH_SECRET", value: "   " }],
      "admin"
    );

    // 空白 secret 被跳过：既不写入也不计入 changedKeys，旧值保留。
    expect(changed).toEqual([]);
    expect(store.get("BETTER_AUTH_SECRET")?.value).toBe("existing-secret");
  });

  it("empty coerced string deletes the row", async () => {
    store.set("NEXT_PUBLIC_APP_NAME", {
      key: "NEXT_PUBLIC_APP_NAME",
      value: "Old Name",
    });

    const changed = await setSystemSettings(
      [{ key: "NEXT_PUBLIC_APP_NAME", value: "   " }],
      "admin"
    );

    expect(changed).toEqual(["NEXT_PUBLIC_APP_NAME"]);
    expect(store.has("NEXT_PUBLIC_APP_NAME")).toBe(false);
    expect(deletedKeys.value).toContain("NEXT_PUBLIC_APP_NAME");
  });

  it("upsert always stamps isSecret from definition not input", async () => {
    // BETTER_AUTH_SECRET 是 secret 定义项，写入时 isSecret 必须取自定义。
    await setSystemSettings(
      [{ key: "BETTER_AUTH_SECRET", value: "fresh-secret" }],
      "admin"
    );
    expect(store.get("BETTER_AUTH_SECRET")?.value).toBe("fresh-secret");
    expect(store.get("BETTER_AUTH_SECRET")?.isSecret).toBe(true);

    // APP_TIME_ZONE 非 secret，isSecret 必为 false。
    await setSystemSettings(
      [{ key: "APP_TIME_ZONE", value: "UTC" }],
      "admin"
    );
    expect(store.get("APP_TIME_ZONE")?.value).toBe("UTC");
    expect(store.get("APP_TIME_ZONE")?.isSecret).toBe(false);
  });

  it("coerces number values and rejects non-numeric (coerceValue, C-L25)", async () => {
    await setSystemSettings(
      [{ key: "IMAGE_BASE_CREDITS_1024", value: "2.5" }],
      "admin"
    );
    expect(store.get("IMAGE_BASE_CREDITS_1024")?.value).toBe(2.5);

    await expect(
      setSystemSettings(
        [{ key: "IMAGE_BASE_CREDITS_1024", value: "not-a-number" }],
        "admin"
      )
    ).rejects.toThrow(/必须是有效数字/);
  });

  it("rejects malformed json and value not in select options (coerceValue, C-L25)", async () => {
    await expect(
      setSystemSettings(
        [{ key: "PLAN_CAPABILITY_MATRIX", value: "{not json" }],
        "admin"
      )
    ).rejects.toThrow(/必须是有效 JSON/);

    await expect(
      setSystemSettings(
        [{ key: "PAYMENT_PROVIDER", value: "definitely-not-an-option" }],
        "admin"
      )
    ).rejects.toThrow(/取值无效/);
  });
});

describe("importSystemSettingsFromEnv", () => {
  beforeEach(() => {
    store.clear();
    deletedKeys.value = [];
    clearSystemSettingsCache();
  });

  afterEach(() => {
    delete process.env.APP_TIME_ZONE;
    delete process.env.BETTER_AUTH_SECRET;
  });

  it("overwrite=false (importMissing) keeps existing stored value", async () => {
    store.set("APP_TIME_ZONE", { key: "APP_TIME_ZONE", value: "Asia/Shanghai" });
    process.env.APP_TIME_ZONE = "UTC";

    await importSystemSettingsFromEnv({ overwrite: false });

    expect(store.get("APP_TIME_ZONE")?.value).toBe("Asia/Shanghai");
  });

  it("overwrite=true replaces stored value with env-derived value", async () => {
    store.set("APP_TIME_ZONE", { key: "APP_TIME_ZONE", value: "Asia/Shanghai" });
    process.env.APP_TIME_ZONE = "UTC";

    await importSystemSettingsFromEnv({ overwrite: true });

    expect(store.get("APP_TIME_ZONE")?.value).toBe("UTC");
  });

  it("flags isSecret true for secret-defined keys", async () => {
    process.env.BETTER_AUTH_SECRET = "env-secret";

    await importSystemSettingsFromEnv({ overwrite: true });

    expect(store.get("BETTER_AUTH_SECRET")?.value).toBe("env-secret");
    expect(store.get("BETTER_AUTH_SECRET")?.isSecret).toBe(true);
  });
});

describe("getAdminSystemSettingsSnapshot", () => {
  beforeEach(() => {
    store.clear();
    deletedKeys.value = [];
    clearSystemSettingsCache();
  });

  afterEach(() => {
    delete process.env.APP_TIME_ZONE;
  });

  it("masks secret values to empty string even when stored", async () => {
    store.set("BETTER_AUTH_SECRET", {
      key: "BETTER_AUTH_SECRET",
      value: "super-secret-value",
      isSecret: true,
    });

    const snapshot = await getAdminSystemSettingsSnapshot();
    const secret = snapshot.find((item) => item.key === "BETTER_AUTH_SECRET");

    expect(secret?.value).toBe("");
    // 密钥已存储，但展示值脱敏；configured/stored 仍如实标记。
    expect(secret?.stored).toBe(true);
    expect(secret?.configured).toBe(true);
  });

  it("returns non-secret stored value verbatim", async () => {
    store.set("APP_TIME_ZONE", {
      key: "APP_TIME_ZONE",
      value: "Asia/Tokyo",
    });

    const snapshot = await getAdminSystemSettingsSnapshot();
    const tz = snapshot.find((item) => item.key === "APP_TIME_ZONE");

    expect(tz?.value).toBe("Asia/Tokyo");
    expect(tz?.stored).toBe(true);
    expect(tz?.fromEnv).toBe(false);
  });

  it("falls back to trimmed env value when not stored and sets fromEnv=true", async () => {
    process.env.APP_TIME_ZONE = "  UTC  ";

    const snapshot = await getAdminSystemSettingsSnapshot();
    const tz = snapshot.find((item) => item.key === "APP_TIME_ZONE");

    expect(tz?.value).toBe("UTC");
    expect(tz?.stored).toBe(false);
    expect(tz?.fromEnv).toBe(true);
  });

  it("JSON.stringifies an object stored value for display", async () => {
    store.set("PLAN_CAPABILITY_MATRIX", {
      key: "PLAN_CAPABILITY_MATRIX",
      value: { version: 1 },
    });

    const snapshot = await getAdminSystemSettingsSnapshot();
    const matrix = snapshot.find(
      (item) => item.key === "PLAN_CAPABILITY_MATRIX"
    );

    expect(matrix?.value).toBe(JSON.stringify({ version: 1 }, null, 2));
  });
});

describe("runtime setting getters stored/env fallback (C-L29)", () => {
  beforeEach(() => {
    store.clear();
    deletedKeys.value = [];
    clearSystemSettingsCache();
  });

  afterEach(() => {
    delete process.env.SELF_USE_MODE_ENABLED;
    delete process.env.APP_TIME_ZONE;
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.PLAN_CAPABILITY_MATRIX;
  });

  it("getRuntimeSettingBoolean reads stored boolean, then env truthy string, else fallback", async () => {
    store.set("SELF_USE_MODE_ENABLED", {
      key: "SELF_USE_MODE_ENABLED",
      value: true,
    });
    await expect(
      getRuntimeSettingBoolean("SELF_USE_MODE_ENABLED")
    ).resolves.toBe(true);

    store.clear();
    clearSystemSettingsCache();
    process.env.SELF_USE_MODE_ENABLED = "yes";
    await expect(
      getRuntimeSettingBoolean("SELF_USE_MODE_ENABLED")
    ).resolves.toBe(true);

    delete process.env.SELF_USE_MODE_ENABLED;
    clearSystemSettingsCache();
    await expect(
      getRuntimeSettingBoolean("SELF_USE_MODE_ENABLED", true)
    ).resolves.toBe(true);
  });

  it("getRuntimeSettingString prefers stored over env and trims", async () => {
    store.set("APP_TIME_ZONE", {
      key: "APP_TIME_ZONE",
      value: "  Asia/Shanghai  ",
    });
    process.env.APP_TIME_ZONE = "UTC";

    await expect(getRuntimeSettingString("APP_TIME_ZONE")).resolves.toBe(
      "Asia/Shanghai"
    );

    store.clear();
    clearSystemSettingsCache();
    await expect(getRuntimeSettingString("APP_TIME_ZONE")).resolves.toBe("UTC");
  });

  it("getRuntimeSettingSelect returns fallback when value not in allowed list", async () => {
    store.set("PAYMENT_PROVIDER", {
      key: "PAYMENT_PROVIDER",
      value: "unknown-provider",
    });

    await expect(
      getRuntimeSettingSelect(
        "PAYMENT_PROVIDER",
        ["creem", "epay"] as const,
        "creem"
      )
    ).resolves.toBe("creem");

    store.set("PAYMENT_PROVIDER", {
      key: "PAYMENT_PROVIDER",
      value: "epay",
    });
    clearSystemSettingsCache();
    await expect(
      getRuntimeSettingSelect(
        "PAYMENT_PROVIDER",
        ["creem", "epay"] as const,
        "creem"
      )
    ).resolves.toBe("epay");
  });

  it("getRuntimeSettingJson parses stored string JSON and returns object directly", async () => {
    store.set("PLAN_CAPABILITY_MATRIX", {
      key: "PLAN_CAPABILITY_MATRIX",
      value: '{"version":2}',
    });
    await expect(
      getRuntimeSettingJson("PLAN_CAPABILITY_MATRIX")
    ).resolves.toEqual({ version: 2 });

    store.set("PLAN_CAPABILITY_MATRIX", {
      key: "PLAN_CAPABILITY_MATRIX",
      value: { version: 3 },
    });
    clearSystemSettingsCache();
    await expect(
      getRuntimeSettingJson("PLAN_CAPABILITY_MATRIX")
    ).resolves.toEqual({ version: 3 });
  });
});
