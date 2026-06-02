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
      "chatCompletionsUpstreamMode",
      "imageUpstreamMode",
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
    imageBackendInflightLease: table("image_backend_inflight_lease", [
      "id",
      "memberType",
      "memberId",
      "expiresAt",
      "createdAt",
    ]),
    imageBackendStickyBinding: table("image_backend_sticky_binding", [
      "id",
      "scope",
      "bindingKey",
      "memberType",
      "memberId",
      "groupId",
      "accountBackend",
      "expiresAt",
      "lastHitAt",
      "hitCount",
      "metadata",
      "createdAt",
      "updatedAt",
    ]),
    imageBackendSchedulerMetric: table("image_backend_scheduler_metric", [
      "id",
      "bucketStartedAt",
      "requestKind",
      "selectedLayer",
      "memberType",
      "memberId",
      "groupId",
      "selectCount",
      "stickyPreviousHitCount",
      "stickySessionHitCount",
      "loadBalanceCount",
      "switchCount",
      "candidateCountTotal",
      "latencyMsTotal",
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
    stickyBindings: [] as Row[],
    schedulerMetrics: [] as Row[],
    limitCalls: [] as { tableName: string; limit: number }[],
    updates: [] as { tableName: string; values: Row }[],
    inserts: [] as { tableName: string; values: Row }[],
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
      case "image_backend_sticky_binding":
        return state.stickyBindings;
      case "image_backend_scheduler_metric":
        return state.schedulerMetrics;
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
    builder.groupBy = vi.fn(() => builder);
    builder.limit = vi.fn((limit: number) => {
      limitValue = limit;
      state.limitCalls.push({ tableName, limit });
      return builder;
    });
    // biome-ignore lint/suspicious/noThenProperty: drizzle query mocks need to be awaitable.
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

  const createInsertBuilder = (table: unknown) => {
    const tableName = tableNameOf(table);
    const builder: Record<string, unknown> = {};
    builder.values = vi.fn((values: Row) => {
      state.inserts.push({ tableName, values });
      return builder;
    });
    builder.onConflictDoUpdate = vi.fn(async () => undefined);
    return builder;
  };

  return {
    state,
    db: {
      select: vi.fn(() => createSelectBuilder()),
      update: vi.fn((table: unknown) => createUpdateBuilder(table)),
      insert: vi.fn((table: unknown) => createInsertBuilder(table)),
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
    gt: (...values: unknown[]) => predicate("gt", values),
    inArray: (...values: unknown[]) => predicate("inArray", values),
    isNull: (...values: unknown[]) => predicate("isNull", values),
    lt: (...values: unknown[]) => predicate("lt", values),
    notInArray: (...values: unknown[]) => predicate("notInArray", values),
    or: (...values: unknown[]) => predicate("or", values),
    sql,
  };
});

vi.mock("@repo/shared/config/subscription-plan", () => ({
  isPlanAtLeast: vi.fn(() => true),
  normalizeSubscriptionPlan: vi.fn(
    (_value: unknown, fallback: string) => fallback
  ),
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
  getRuntimeSettingBoolean: vi.fn(
    async (_key: string, fallback = false) => fallback
  ),
  getRuntimeSettingJson: vi.fn(async () => undefined),
  getRuntimeSettingNumber: vi.fn(
    async (_key: string, fallback: number) => fallback
  ),
  getRuntimeSettingSelect: vi.fn(
    async (_key: string, fallback: string) => fallback
  ),
  getRuntimeSettingString: vi.fn(async () => ""),
}));

vi.mock("@/features/image-generation/chatgpt-web", () => ({
  getChatGptWebAccountInfo: vi.fn(),
}));

import {
  reportImageBackendResult,
  resolveImageBackendPoolConfig,
  resetImageBackendInflightForTests,
} from "./service";
import { getRuntimeSettingBoolean } from "@repo/shared/system-settings";

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
    lastAcquiredAt: null,
    createdAt: new Date(2026, 0, index),
    metadata: null,
  };
}

describe("image backend pool scheduler selection", () => {
  beforeEach(() => {
    resetImageBackendInflightForTests();
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
    dbMock.state.stickyBindings = [];
    dbMock.state.schedulerMetrics = [];
    dbMock.state.limitCalls = [];
    dbMock.state.updates = [];
    dbMock.state.inserts = [];
    vi.clearAllMocks();
    vi.mocked(getRuntimeSettingBoolean).mockImplementation(
      async (_key: string, fallback = false) => fallback
    );
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
    expect(dbMock.state.limitCalls.filter((call) => call.limit === 50)).toEqual(
      []
    );
  });

  it("reserves backend capacity during selection and skips saturated members", async () => {
    dbMock.state.accounts = [makeAccount(1), makeAccount(2)];

    const first = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "image_generation",
    });
    const second = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "image_generation",
    });
    const third = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "image_generation",
    });

    expect(first?.memberId).toBe("acct-1");
    expect(second?.memberId).toBe("acct-2");
    expect(third).toBeNull();
  });

  it("round-robins across equal healthy accounts instead of filling high-concurrency accounts first", async () => {
    dbMock.state.accounts = Array.from({ length: 10 }, (_, index) => ({
      ...makeAccount(index + 1),
      concurrency: 50,
    }));

    const selected: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const result = await resolveImageBackendPoolConfig({
        userId: "user-a",
        requestKind: "image_generation",
      });
      if (result?.memberId) selected.push(result.memberId);
    }

    expect(new Set(selected).size).toBe(10);
    expect(selected).toEqual([
      "acct-1",
      "acct-2",
      "acct-3",
      "acct-4",
      "acct-5",
      "acct-6",
      "acct-7",
      "acct-8",
      "acct-9",
      "acct-10",
    ]);
  });

  it("tries the sticky previous-response backend before normal scheduling", async () => {
    dbMock.state.accounts = [
      {
        ...makeAccount(1),
        priority: 1,
        createdAt: new Date(2026, 0, 1),
      },
      {
        ...makeAccount(2),
        priority: 99,
        createdAt: new Date(2026, 0, 2),
      },
    ];

    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "responses",
      preferredMemberId: "acct-2",
      preferredMemberType: "account",
    });

    expect(result?.memberType).toBe("account");
    expect(result?.memberId).toBe("acct-2");
  });

  it("uses persisted previous-response sticky bindings before request preferences", async () => {
    dbMock.state.accounts = [makeAccount(1), makeAccount(2)];
    dbMock.state.stickyBindings = [
      {
        memberType: "account",
        memberId: "acct-2",
        groupId: "group-a",
        accountBackend: "responses",
      },
    ];

    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "responses",
      stickyPreviousResponseId: "resp-a",
      preferredMemberId: "acct-1",
      preferredMemberType: "account",
    });

    expect(result?.memberType).toBe("account");
    expect(result?.memberId).toBe("acct-2");
    expect(result?.schedulerLayer).toBe("previous_response_id");
  });

  it("records scheduler selection metrics", async () => {
    dbMock.state.accounts = [makeAccount(1)];

    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "responses",
    });

    expect(result?.memberId).toBe("acct-1");
    const metricInsert = dbMock.state.inserts.find(
      (item) => item.tableName === "image_backend_scheduler_metric"
    );
    expect(metricInsert?.values).toMatchObject({
      requestKind: "responses",
      selectedLayer: "load_balance",
      memberType: "account",
      memberId: "acct-1",
      selectCount: 1,
    });
  });

  it("uses scheduler health metadata to demote unhealthy peers at the same priority", async () => {
    dbMock.state.accounts = [
      {
        ...makeAccount(1),
        priority: 10,
        metadata: {
          scheduler: {
            errorEwma: 0.9,
            durationMsEwma: 180_000,
            failStreak: 5,
          },
        },
      },
      {
        ...makeAccount(2),
        priority: 10,
        metadata: {
          scheduler: {
            errorEwma: 0.05,
            durationMsEwma: 20_000,
            successStreak: 3,
          },
        },
      },
    ];

    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "responses",
    });

    expect(result?.memberType).toBe("account");
    expect(result?.memberId).toBe("acct-2");
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
    dbMock.state.externalApiKeys = [{ id: "key-a", generationGroupId: null }];
    dbMock.state.userPreferences = [{ userId: "user-a", groupId: "api-group" }];
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
    dbMock.state.userPreferences = [{ userId: "user-a", groupId: "api-group" }];
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

  it("uses the images upstream switch for responses-only API image requests", async () => {
    const baseApi = {
      id: "api-1",
      groupId: "group-a",
      name: "External Responses",
      baseUrl: "https://api.example.test/v1",
      apiKey: "key",
      model: "external-chat-model",
      interfaceMode: "responses",
      chatCompletionsUpstreamMode: "responses",
      useStream: false,
      contentSafetyEnabled: true,
      priority: 1,
      concurrency: 1,
      lastUsedAt: null,
      createdAt: new Date(2026, 0, 1),
    };
    dbMock.state.accounts = [];
    dbMock.state.apis = [{ ...baseApi, imageUpstreamMode: "images" }];

    await expect(
      resolveImageBackendPoolConfig({
        userId: "user-a",
        requestKind: "image_generation",
      })
    ).resolves.toBeNull();

    dbMock.state.apis = [{ ...baseApi, imageUpstreamMode: "responses" }];
    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "image_generation",
    });

    expect(result?.memberType).toBe("api");
    expect(result?.memberId).toBe("api-1");
    expect(result?.config.backend).toMatchObject({
      apiInterfaceMode: "responses",
      imagesUpstreamMode: "responses",
    });
  });

  it("can borrow any Responses backend when the requested group is Web-only", async () => {
    dbMock.state.groups = [
      {
        id: "web-group",
        name: "Web only",
        description: null,
        isEnabled: true,
        isDefault: true,
        isUserSelectable: true,
        contentSafetyEnabled: null,
        priority: 1,
        metadata: { backendType: "web" },
        createdAt: new Date(2026, 0, 1),
        updatedAt: new Date(2026, 0, 1),
      },
      {
        id: "codex-group",
        name: "Codex repair",
        description: null,
        isEnabled: true,
        isDefault: false,
        isUserSelectable: true,
        contentSafetyEnabled: null,
        priority: 2,
        metadata: { backendType: "responses" },
        createdAt: new Date(2026, 0, 2),
        updatedAt: new Date(2026, 0, 2),
      },
    ];
    dbMock.state.accounts = [
      {
        ...makeAccount(1),
        matchedGroupId: "codex-group",
        groupId: "codex-group",
      },
    ];

    await expect(
      resolveImageBackendPoolConfig({
        userId: "user-a",
        requestKind: "responses",
      })
    ).resolves.toBeNull();

    const result = await resolveImageBackendPoolConfig({
      userId: "user-a",
      requestKind: "responses",
      accountBackendPreference: "responses",
      allowAnyResponsesBackend: true,
    });

    expect(result?.memberType).toBe("account");
    expect(result?.memberId).toBe("acct-1");
    expect(result?.groupId).toBe("codex-group");
  });

  it("reactivates limited accounts after a successful retry", async () => {
    dbMock.state.accounts = [
      {
        ...makeAccount(1),
        status: "limited",
        cooldownUntil: new Date(2026, 0, 1),
      },
    ];

    await reportImageBackendResult({
      memberType: "account",
      memberId: "acct-1",
      success: true,
    });

    const update = dbMock.state.updates.find(
      (item) => item.tableName === "image_backend_account"
    );
    expect(update?.values).toMatchObject({
      status: "active",
      cooldownUntil: null,
      lastError: null,
      lastErrorAt: null,
      metadata: expect.objectContaining({
        scheduler: expect.objectContaining({
          errorEwma: 0,
          successStreak: 1,
          failStreak: 0,
        }),
      }),
    });
  });

  it("updates scheduler EWMA metadata after failures", async () => {
    dbMock.state.accounts = [
      {
        ...makeAccount(1),
        metadata: {
          source: "sub2api_postgres",
          scheduler: {
            errorEwma: 0.25,
            durationMsEwma: 10_000,
            successStreak: 2,
          },
        },
      },
    ];

    await reportImageBackendResult({
      memberType: "account",
      memberId: "acct-1",
      success: false,
      error: "HTTP 500 upstream error",
      durationMs: 20_000,
    });

    const update = dbMock.state.updates.find(
      (item) => item.tableName === "image_backend_account"
    );
    expect(update?.values.metadata).toMatchObject({
      source: "sub2api_postgres",
      scheduler: {
        errorEwma: 0.4,
        durationMsEwma: 12_000,
        successStreak: 0,
        failStreak: 1,
        lastObservedAt: expect.any(String),
      },
    });
  });

  it("reactivates limited API backends after a successful retry", async () => {
    dbMock.state.apis = [
      {
        id: "api-1",
        groupId: "group-a",
        status: "limited",
        cooldownUntil: new Date(2026, 0, 1),
      },
    ];

    await reportImageBackendResult({
      memberType: "api",
      memberId: "api-1",
      success: true,
    });

    const update = dbMock.state.updates.find(
      (item) => item.tableName === "image_backend_api"
    );
    expect(update?.values).toMatchObject({
      status: "active",
      cooldownUntil: null,
      lastError: null,
      lastErrorAt: null,
    });
  });

  it("does not cool down external API backends after transient failures by default", async () => {
    await reportImageBackendResult({
      memberType: "api",
      memberId: "api-1",
      success: false,
      error: "HTTP 429 Too many requests",
      retryAfterSeconds: 60,
    });

    const update = dbMock.state.updates.find(
      (item) => item.tableName === "image_backend_api"
    );
    expect(update?.values).toMatchObject({
      lastError: "HTTP 429 Too many requests",
      lastErrorAt: expect.any(Date),
    });
    expect(update?.values).not.toHaveProperty("status");
    expect(update?.values).not.toHaveProperty("cooldownUntil");
  });

  it("can cool down external API backends when explicitly enabled", async () => {
    vi.mocked(getRuntimeSettingBoolean).mockImplementation(
      async (key: string, fallback = false) =>
        key === "IMAGE_BACKEND_API_FAILURE_COOLDOWN_ENABLED" ? true : fallback
    );

    await reportImageBackendResult({
      memberType: "api",
      memberId: "api-1",
      success: false,
      error: "HTTP 429 Too many requests",
      retryAfterSeconds: 60,
    });

    const update = dbMock.state.updates.find(
      (item) => item.tableName === "image_backend_api"
    );
    expect(update?.values).toMatchObject({
      status: "active",
      cooldownUntil: expect.any(Date),
      lastError: "HTTP 429 Too many requests",
      lastErrorAt: expect.any(Date),
    });
  });

  it("still marks external API backends as error for unrecoverable failures", async () => {
    await reportImageBackendResult({
      memberType: "api",
      memberId: "api-1",
      success: false,
      error: "invalid api key authentication failed",
    });

    const update = dbMock.state.updates.find(
      (item) => item.tableName === "image_backend_api"
    );
    expect(update?.values).toMatchObject({
      status: "error",
      cooldownUntil: null,
      lastError: "invalid api key authentication failed",
      lastErrorAt: expect.any(Date),
    });
  });

  it("keeps account backend cooldown behavior unchanged", async () => {
    await reportImageBackendResult({
      memberType: "account",
      memberId: "acct-1",
      success: false,
      error: "HTTP 429 Too many requests",
      retryAfterSeconds: 60,
    });

    const update = dbMock.state.updates.find(
      (item) => item.tableName === "image_backend_account"
    );
    expect(update?.values).toMatchObject({
      status: "active",
      cooldownUntil: expect.any(Date),
      lastError: "HTTP 429 Too many requests",
      lastErrorAt: expect.any(Date),
    });
  });
});
