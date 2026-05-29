import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const schemaMock = vi.hoisted(() => {
  const column = (tableName: string, columnName: string) => ({
    __columnName: columnName,
    __tableName: tableName,
  });
  const table = <T extends readonly string[]>(tableName: string, columns: T) =>
    Object.fromEntries([
      ["__tableName", tableName],
      ...columns.map((name) => [name, column(tableName, name)]),
    ]);

  return {
    externalApiKey: table("external_api_key", ["id", "generationGroupId"]),
    imageBackendAccount: table("image_backend_account", [
      "id",
      "groupId",
      "name",
      "accessToken",
      "model",
      "implementationMode",
      "contentSafetyEnabled",
      "isEnabled",
      "priority",
      "concurrency",
      "successCount",
      "failCount",
      "status",
      "lastUsedAt",
      "lastAcquiredAt",
      "cooldownUntil",
      "lastError",
      "lastErrorAt",
      "metadata",
      "createdAt",
      "updatedAt",
    ]),
    imageBackendAccountGroup: table("image_backend_account_group", [
      "accountId",
      "groupId",
    ]),
    imageBackendApi: table("image_backend_api", [
      "id",
      "groupId",
      "name",
      "baseUrl",
      "apiKey",
      "model",
      "interfaceMode",
      "useStream",
      "contentSafetyEnabled",
      "isEnabled",
      "priority",
      "concurrency",
      "successCount",
      "failCount",
      "status",
      "lastUsedAt",
      "lastAcquiredAt",
      "cooldownUntil",
      "lastError",
      "lastErrorAt",
      "metadata",
      "createdAt",
      "updatedAt",
    ]),
    imageBackendGroup: table("image_backend_group", [
      "id",
      "name",
      "description",
      "isEnabled",
      "isDefault",
      "isUserSelectable",
      "contentSafetyEnabled",
      "priority",
      "metadata",
      "createdAt",
      "updatedAt",
    ]),
    systemSetting: table("system_setting", ["key", "value"]),
    userImageBackendPreference: table("user_image_backend_preference", [
      "userId",
      "groupId",
    ]),
  };
});

const dbMock = vi.hoisted(() => {
  const state = {
    groups: [] as Row[],
    accounts: [] as Row[],
    apis: [] as Row[],
    userPreferences: [] as Row[],
    externalApiKeys: [] as Row[],
    limitCalls: [] as { tableName: string; limit: number }[],
    updates: [] as { tableName: string; values: Row }[],
  };

  const tableNameOf = (table: unknown) =>
    typeof table === "object" && table && "__tableName" in table
      ? String((table as { __tableName: string }).__tableName)
      : "";

  const rowsForTable = (tableName: string) => {
    switch (tableName) {
      case "external_api_key":
        return state.externalApiKeys;
      case "image_backend_account":
        return state.accounts;
      case "image_backend_api":
        return state.apis;
      case "image_backend_group":
        return state.groups;
      case "user_image_backend_preference":
        return state.userPreferences;
      default:
        return [];
    }
  };

  const createSelectBuilder = () => {
    let tableName = "";
    let limitValue: number | null = null;
    const builder: Record<string, unknown> = {};
    builder.from = vi.fn((table: unknown) => {
      tableName = tableNameOf(table);
      return builder;
    });
    builder.innerJoin = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.orderBy = vi.fn(() => builder);
    builder.limit = vi.fn((limit: number) => {
      limitValue = limit;
      state.limitCalls.push({ tableName, limit });
      return builder;
    });
    builder.then = (
      resolve: (value: Row[]) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      const rows =
        limitValue === null
          ? rowsForTable(tableName)
          : rowsForTable(tableName).slice(0, limitValue);
      return Promise.resolve(rows).then(resolve, reject);
    };
    return builder;
  };

  const createUpdateBuilder = (table: unknown) => {
    const tableName = tableNameOf(table);
    const builder: Record<string, unknown> = {};
    builder.set = vi.fn((values: Row) => {
      state.updates.push({ tableName, values });
      return builder;
    });
    builder.where = vi.fn(async () => undefined);
    return builder;
  };

  return {
    state,
    db: {
      select: vi.fn(() => createSelectBuilder()),
      update: vi.fn((table: unknown) => createUpdateBuilder(table)),
    },
  };
});

vi.mock("@repo/database", () => ({
  db: dbMock.db,
}));

vi.mock("@repo/database/schema", () => schemaMock);

vi.mock("drizzle-orm", () => {
  const predicate = (kind: string, values: unknown[]) => ({ kind, values });
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    strings,
    values,
  });
  return {
    and: (...values: unknown[]) => predicate("and", values),
    asc: (...values: unknown[]) => predicate("asc", values),
    count: (...values: unknown[]) => predicate("count", values),
    desc: (...values: unknown[]) => predicate("desc", values),
    eq: (...values: unknown[]) => predicate("eq", values),
    inArray: (...values: unknown[]) => predicate("inArray", values),
    isNull: (...values: unknown[]) => predicate("isNull", values),
    notInArray: (...values: unknown[]) => predicate("notInArray", values),
    or: (...values: unknown[]) => predicate("or", values),
    sql,
  };
});

vi.mock("@repo/shared/config/subscription-plan", () => ({
  isPlanAtLeast: vi.fn(() => true),
  normalizeSubscriptionPlan: vi.fn((_value: unknown, fallback: string) => fallback),
}));

vi.mock("@repo/shared/image-backend/nested-groups", () => ({
  validateNestedGroupConfig: vi.fn(() => ({ ok: true })),
}));

vi.mock("@repo/shared/logger", () => ({
  logWarn: vi.fn(),
}));

vi.mock("@repo/shared/subscription/services/plan-capabilities", () => ({
  canUsePlanCapability: vi.fn(() => true),
}));

vi.mock("@repo/shared/subscription/services/user-plan", () => ({
  getUserPlan: vi.fn(async () => ({ plan: "ultra" })),
}));

vi.mock("@repo/shared/system-settings", () => ({
  clearSystemSettingsCache: vi.fn(),
  getRuntimeSettingBoolean: vi.fn(async (_key: string, fallback = false) => fallback),
  getRuntimeSettingJson: vi.fn(async () => undefined),
  getRuntimeSettingNumber: vi.fn(async (_key: string, fallback: number) => fallback),
  getRuntimeSettingSelect: vi.fn(async (_key: string, fallback: string) => fallback),
  getRuntimeSettingString: vi.fn(async () => ""),
}));

vi.mock("@/features/image-generation/chatgpt-web", () => ({
  getChatGptWebAccountInfo: vi.fn(),
}));

import { resolveImageBackendPoolConfig } from "./service";

function makeAccount(index: number) {
  return {
    matchedGroupId: "group-a",
    id: `acct-${index}`,
    groupId: null,
    name: `Account ${index}`,
    accessToken: `token-${index}`,
    model: null,
    implementationMode: "responses",
    contentSafetyEnabled: true,
    priority: 10,
    concurrency: 1,
    lastUsedAt: null,
    createdAt: new Date(2026, 0, index),
    metadata: null,
  };
}

describe("image backend pool scheduler selection", () => {
  beforeEach(() => {
    dbMock.state.groups = [
      {
        id: "group-a",
        name: "Codex group",
        description: null,
        isEnabled: true,
        isDefault: true,
        isUserSelectable: true,
        contentSafetyEnabled: null,
        priority: 1,
        metadata: { backendType: "responses" },
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
      },
    ];
    dbMock.state.accounts = Array.from({ length: 55 }, (_, index) =>
      makeAccount(index + 1)
    );
    dbMock.state.apis = [];
    dbMock.state.userPreferences = [];
    dbMock.state.externalApiKeys = [];
    dbMock.state.limitCalls = [];
    dbMock.state.updates = [];
    vi.clearAllMocks();
  });

  it("does not truncate runtime backend candidates at 50", async () => {
    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "image_generation",
      excludedMemberKeys: Array.from(
        { length: 50 },
        (_, index) => `account:acct-${index + 1}`
      ),
    });

    expect(result?.memberType).toBe("account");
    expect(result?.memberId).toBe("acct-51");
    expect(
      dbMock.state.limitCalls.filter((call) => call.limit === 50)
    ).toEqual([]);
  });

  it("uses the platform default group for API keys without an explicit group", async () => {
    dbMock.state.groups = [
      {
        id: "default-group",
        name: "Default",
        description: null,
        isEnabled: true,
        isDefault: true,
        isUserSelectable: true,
        contentSafetyEnabled: null,
        priority: 1,
        metadata: { backendType: "responses" },
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
      },
      {
        id: "api-group",
        name: "API",
        description: null,
        isEnabled: true,
        isDefault: false,
        isUserSelectable: false,
        contentSafetyEnabled: true,
        priority: 10,
        metadata: { backendType: "mixed" },
        createdAt: new Date(2026, 0, 2),
        updatedAt: new Date(2026, 0, 2),
      },
    ];
    dbMock.state.externalApiKeys = [
      { id: "key-a", generationGroupId: null },
    ];
    dbMock.state.userPreferences = [
      { userId: "user-a", groupId: "api-group" },
    ];
    dbMock.state.accounts = [
      {
        ...makeAccount(1),
        matchedGroupId: "default-group",
        groupId: "default-group",
      },
    ];

    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      apiKeyId: "key-a",
      requestKind: "image_generation",
    });

    expect(result?.groupId).toBe("default-group");
    expect(result?.config.backend?.billingGroupId).toBe("default-group");
  });

  it("ignores stale user preferences that point to non-selectable groups", async () => {
    dbMock.state.groups = [
      {
        id: "default-group",
        name: "Default",
        description: null,
        isEnabled: true,
        isDefault: true,
        isUserSelectable: true,
        contentSafetyEnabled: null,
        priority: 1,
        metadata: { backendType: "responses" },
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
      },
      {
        id: "api-group",
        name: "API",
        description: null,
        isEnabled: true,
        isDefault: false,
        isUserSelectable: false,
        contentSafetyEnabled: true,
        priority: 10,
        metadata: { backendType: "mixed" },
        createdAt: new Date(2026, 0, 2),
        updatedAt: new Date(2026, 0, 2),
      },
    ];
    dbMock.state.userPreferences = [
      { userId: "user-a", groupId: "api-group" },
    ];
    dbMock.state.accounts = [
      {
        ...makeAccount(1),
        matchedGroupId: "default-group",
        groupId: "default-group",
      },
    ];

    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "image_generation",
    });

    expect(result?.groupId).toBe("default-group");
    expect(result?.config.backend?.billingGroupId).toBe("default-group");
  });
});
