import { createHash } from "node:crypto";
import { db } from "@repo/database";
import {
  externalApiKey,
  imageBackendAccount,
  imageBackendApi,
  imageBackendGroup,
  userImageBackendPreference,
} from "@repo/database/schema";
import {
  getRuntimeSettingNumber,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";
import { logWarn } from "@repo/shared/logger";
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Pool } from "pg";

import type { ApiConfig } from "@/features/image-generation/types";
import {
  getChatGptWebAccountInfo,
  type ChatGptWebAccountInfo,
} from "@/features/image-generation/chatgpt-web";

import type {
  ImageBackendAccountBackend,
  ContentSafetyOverride,
  ImageBackendGroupSummary,
  ImageBackendRequestKind,
} from "./types";

type ResolveBackendOptions = {
  userId: string;
  apiKeyId?: string;
  requestKind: ImageBackendRequestKind;
};

type PoolMember =
  | {
      type: "api";
      id: string;
      groupId: string | null;
      name: string;
      baseUrl: string;
      apiKey: string;
      model: string | null;
      useStream: boolean;
      contentSafetyEnabled: boolean;
      priority: number;
      lastUsedAt: Date | null;
      createdAt: Date;
    }
  | {
      type: "account";
      id: string;
      groupId: string | null;
      name: string;
      accessToken: string;
      model: string | null;
      implementationMode: string;
      contentSafetyEnabled: boolean;
      priority: number;
      lastUsedAt: Date | null;
      createdAt: Date;
      metadata: Record<string, unknown> | null;
    };

export type ResolvedImageBackendPoolConfig = {
  config: ApiConfig;
  groupId: string | null;
  memberId: string;
  memberType: "api" | "account";
  contentSafetyEnabled: boolean;
};

export type ImageBackendReportResultInput = {
  memberType?: "api" | "account";
  memberId?: string;
  success: boolean;
  error?: string | null;
};

type WebAccountRuntimeMetadata = ChatGptWebAccountInfo & {
  refreshedAt?: string;
};

type BackendMetadata = Record<string, unknown> & {
  webAccount?: Partial<WebAccountRuntimeMetadata>;
};

const CHATGPT_CODEX_RESPONSES_URL =
  "https://chatgpt.com/backend-api/codex";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_PLATFORM_OAUTH_CLIENT_ID = "app_2SKx67EdpoN0G6j64rFvigXD";
const OPENAI_REFRESH_SCOPES = "openid profile email";
const RATE_LIMIT_COOLDOWN_MINUTES = 10;
const TEMPORARY_ERROR_COOLDOWN_MINUTES = 2;

function normalizeAccountBackend(value?: string | null): ImageBackendAccountBackend {
  return value === "responses" ? "responses" : "web";
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function hashBackendCredential(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

export function fromSafetyOverride(value: ContentSafetyOverride) {
  if (value === "enabled") return true;
  if (value === "disabled") return false;
  return null;
}

function effectiveContentSafety(
  groupValue: boolean | null,
  memberValue: boolean
) {
  return groupValue ?? memberValue;
}

function memberTimestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  return new Date(value).getTime();
}

function isRetryableBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("econnreset") ||
    normalized.includes("fetch failed") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("overloaded") ||
    normalized.includes("temporarily unavailable")
  );
}

function classifyFailure(error?: string | null): {
  status?: string;
  cooldownUntil?: Date | null;
} {
  const normalized = (error || "").toLowerCase();
  if (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid api key") ||
    normalized.includes("invalid access token")
  ) {
    return { status: "error", cooldownUntil: null };
  }
  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    return {
      status: "active",
      cooldownUntil: new Date(Date.now() + RATE_LIMIT_COOLDOWN_MINUTES * 60_000),
    };
  }
  if (isRetryableBackendError(error)) {
    return {
      status: "active",
      cooldownUntil: new Date(
        Date.now() + TEMPORARY_ERROR_COOLDOWN_MINUTES * 60_000
      ),
    };
  }
  return {};
}

function truncateError(value?: string | null) {
  if (!value) return null;
  return value.length > 2000 ? value.slice(0, 2000) : value;
}

function asBackendMetadata(value: unknown): BackendMetadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? ({ ...(value as Record<string, unknown>) } as BackendMetadata)
    : {};
}

function normalizeWebAccountMetadata(
  metadata: Record<string, unknown> | null | undefined
): WebAccountRuntimeMetadata | null {
  const raw = asBackendMetadata(metadata).webAccount;
  if (!raw || typeof raw !== "object") return null;
  const quota = Number(raw.quota);
  const type = String(raw.type || "free");
  return {
    email: typeof raw.email === "string" ? raw.email : null,
    userId: typeof raw.userId === "string" ? raw.userId : null,
    type,
    quota: Number.isFinite(quota) ? Math.max(0, Math.trunc(quota)) : 0,
    imageQuotaUnknown: Boolean(raw.imageQuotaUnknown),
    limitsProgress: Array.isArray(raw.limitsProgress)
      ? raw.limitsProgress
      : [],
    defaultModelSlug:
      typeof raw.defaultModelSlug === "string" ? raw.defaultModelSlug : null,
    restoreAt: typeof raw.restoreAt === "string" ? raw.restoreAt : null,
    status: raw.status === "limited" ? "limited" : "active",
    refreshedAt:
      typeof raw.refreshedAt === "string" ? raw.refreshedAt : undefined,
  };
}

function mergeWebAccountMetadata(
  metadata: Record<string, unknown> | null | undefined,
  accountInfo: ChatGptWebAccountInfo
): BackendMetadata {
  return {
    ...asBackendMetadata(metadata),
    webAccount: {
      ...accountInfo,
      refreshedAt: new Date().toISOString(),
    },
  };
}

function parseMetadataDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWebAccountQuotaAvailable(
  backend: ImageBackendAccountBackend,
  metadata: Record<string, unknown> | null | undefined,
  now: Date
) {
  if (backend !== "web") return true;
  const webAccount = normalizeWebAccountMetadata(metadata);
  if (!webAccount) return true;
  if (webAccount.imageQuotaUnknown) return true;
  if (webAccount.quota > 0) return true;
  const restoreAt = parseMetadataDate(webAccount.restoreAt);
  return Boolean(restoreAt && restoreAt <= now);
}

function nextWebAccountMetadataAfterSuccess(
  metadata: Record<string, unknown> | null | undefined
) {
  const webAccount = normalizeWebAccountMetadata(metadata);
  if (!webAccount || webAccount.imageQuotaUnknown) {
    return {
      metadata: metadata ?? null,
      status: "active",
      cooldownUntil: null as Date | null,
    };
  }

  const nextQuota = Math.max(0, webAccount.quota - 1);
  const nextMetadataStatus = nextQuota === 0 ? "limited" : "active";
  const restoreAt = parseMetadataDate(webAccount.restoreAt);
  return {
    metadata: {
      ...asBackendMetadata(metadata),
      webAccount: {
        ...webAccount,
        quota: nextQuota,
        status: nextMetadataStatus,
      },
    },
    status: "active",
    cooldownUntil: nextMetadataStatus === "limited" ? restoreAt : null,
  };
}

function backendKey(member: Pick<PoolMember, "type" | "id">) {
  return `${member.type}:${member.id}`;
}

async function getDefaultGroupId() {
  const [defaultGroup] = await db
    .select({ id: imageBackendGroup.id })
    .from(imageBackendGroup)
    .where(
      and(eq(imageBackendGroup.isEnabled, true), eq(imageBackendGroup.isDefault, true))
    )
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt))
    .limit(1);

  if (defaultGroup) return defaultGroup.id;

  const [firstGroup] = await db
    .select({ id: imageBackendGroup.id })
    .from(imageBackendGroup)
    .where(eq(imageBackendGroup.isEnabled, true))
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt))
    .limit(1);

  return firstGroup?.id ?? null;
}

async function resolveRequestedGroupId(options: ResolveBackendOptions) {
  if (options.apiKeyId) {
    const [key] = await db
      .select({ groupId: externalApiKey.generationGroupId })
      .from(externalApiKey)
      .where(eq(externalApiKey.id, options.apiKeyId))
      .limit(1);
    if (key?.groupId) return key.groupId;
  }

  const [preference] = await db
    .select({ groupId: userImageBackendPreference.groupId })
    .from(userImageBackendPreference)
    .where(eq(userImageBackendPreference.userId, options.userId))
    .limit(1);

  return preference?.groupId || (await getDefaultGroupId());
}

async function ensureGroupUsable(groupId: string | null) {
  if (!groupId) return null;
  const [group] = await db
    .select()
    .from(imageBackendGroup)
    .where(and(eq(imageBackendGroup.id, groupId), eq(imageBackendGroup.isEnabled, true)))
    .limit(1);
  return group ?? null;
}

async function selectPoolMember(
  groupId: string | null,
  requestKind: ImageBackendRequestKind,
  excluded?: Set<string>
): Promise<PoolMember | null> {
  const apiGroupFilter = groupId ? eq(imageBackendApi.groupId, groupId) : sql`true`;
  const accountGroupFilter = groupId
    ? eq(imageBackendAccount.groupId, groupId)
    : sql`true`;
  const now = new Date();

  const [apiRows, accountRows] = await Promise.all([
    db
      .select()
      .from(imageBackendApi)
      .where(
        and(
          eq(imageBackendApi.isEnabled, true),
          apiGroupFilter,
          eq(imageBackendApi.status, "active"),
          or(
            sql`${imageBackendApi.cooldownUntil} IS NULL`,
            sql`${imageBackendApi.cooldownUntil} <= ${now}`
          )
        )
      )
      .orderBy(
        asc(imageBackendApi.priority),
        asc(imageBackendApi.lastUsedAt),
        asc(imageBackendApi.createdAt)
      )
      .limit(50),
    db
      .select()
      .from(imageBackendAccount)
      .where(
        and(
          eq(imageBackendAccount.isEnabled, true),
          accountGroupFilter,
          eq(imageBackendAccount.status, "active"),
          or(
            sql`${imageBackendAccount.cooldownUntil} IS NULL`,
            sql`${imageBackendAccount.cooldownUntil} <= ${now}`
          )
        )
      )
      .orderBy(
        asc(imageBackendAccount.priority),
        asc(imageBackendAccount.lastUsedAt),
        asc(imageBackendAccount.createdAt)
      )
      .limit(50),
  ]);

  const apiMembers: PoolMember[] = apiRows.map((row) => ({
    type: "api",
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.model,
    useStream: row.useStream,
    contentSafetyEnabled: row.contentSafetyEnabled,
    priority: row.priority,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  }));

  const accountMembers: PoolMember[] = accountRows
    .filter((row) => {
      const backend = normalizeAccountBackend(row.implementationMode);
      return (
        (requestKind !== "responses" || backend === "responses") &&
        isWebAccountQuotaAvailable(backend, row.metadata, now)
      );
    })
    .map((row) => ({
      type: "account",
      id: row.id,
      groupId: row.groupId,
      name: row.name,
      accessToken: row.accessToken,
      model: row.model,
      implementationMode: row.implementationMode,
      contentSafetyEnabled: row.contentSafetyEnabled,
      priority: row.priority,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      metadata: row.metadata,
    }));

  return [...apiMembers, ...accountMembers]
    .filter((member) => !excluded?.has(backendKey(member)))
    .sort((left, right) => {
      const priorityDiff = left.priority - right.priority;
      if (priorityDiff !== 0) return priorityDiff;
      const lastUsedDiff =
        memberTimestamp(left.lastUsedAt) - memberTimestamp(right.lastUsedAt);
      if (lastUsedDiff !== 0) return lastUsedDiff;
      return memberTimestamp(left.createdAt) - memberTimestamp(right.createdAt);
    })[0] ?? null;
}

async function touchSelectedMember(member: PoolMember) {
  const now = new Date();
  if (member.type === "api") {
    await db
      .update(imageBackendApi)
      .set({ lastUsedAt: now, lastAcquiredAt: now, updatedAt: now })
      .where(eq(imageBackendApi.id, member.id));
    return;
  }

  await db
    .update(imageBackendAccount)
    .set({ lastUsedAt: now, lastAcquiredAt: now, updatedAt: now })
    .where(eq(imageBackendAccount.id, member.id));
}

function toResolvedPoolConfig(
  groupId: string,
  groupContentSafetyEnabled: boolean | null,
  member: PoolMember
): ResolvedImageBackendPoolConfig {
  const contentSafetyEnabled = effectiveContentSafety(
    groupContentSafetyEnabled,
    member.contentSafetyEnabled
  );

  if (member.type === "api") {
    return {
      config: {
        baseUrl: stripTrailingSlash(member.baseUrl),
        apiKey: member.apiKey,
        model: member.model || undefined,
        useStream: member.useStream,
        contentSafetyEnabled,
        backend: {
          type: "pool-api",
          id: member.id,
          groupId,
          reportResult: true,
        },
      },
      groupId,
      memberId: member.id,
      memberType: "api",
      contentSafetyEnabled,
    };
  }

  const implementationMode = normalizeAccountBackend(member.implementationMode);
  const isResponsesBackend = implementationMode === "responses";

  return {
    config: {
      baseUrl: isResponsesBackend
        ? CHATGPT_CODEX_RESPONSES_URL
        : "https://chatgpt.com",
      apiKey: member.accessToken,
      model: member.model || undefined,
      contentSafetyEnabled,
      headers: isResponsesBackend
        ? {
            "OpenAI-Beta": "responses=experimental",
            originator: "codex_cli_rs",
            "User-Agent": "codex_cli_rs/0.1.0",
          }
        : undefined,
      backend: {
        type: "pool-account",
        id: member.id,
        groupId,
        accountBackend: implementationMode,
        reportResult: true,
      },
    },
    groupId,
    memberId: member.id,
    memberType: "account",
    contentSafetyEnabled,
  };
}

async function resolvePoolMember(
  options: ResolveBackendOptions & { excluded?: Set<string> }
) {
  const requestedGroupId = await resolveRequestedGroupId(options);
  const group = await ensureGroupUsable(requestedGroupId);
  if (!group) return null;

  const member = await selectPoolMember(
    group.id,
    options.requestKind,
    options.excluded
  );
  if (!member) return null;

  return { group, member };
}

export async function resolveImageBackendPoolConfig(
  options: ResolveBackendOptions
): Promise<ResolvedImageBackendPoolConfig | null> {
  const resolved = await resolvePoolMember(options);
  if (!resolved) return null;
  await touchSelectedMember(resolved.member);
  const result = toResolvedPoolConfig(
    resolved.group.id,
    resolved.group.contentSafetyEnabled,
    resolved.member
  );
  if (result.config.backend) {
    result.config.backend.requestKind = options.requestKind;
  }
  return result;
}

export async function reportImageBackendResult(input: ImageBackendReportResultInput) {
  if (!input.memberId || !input.memberType) return;
  const now = new Date();
  const error = truncateError(input.error);
  const failure = input.success ? {} : classifyFailure(error);

  if (input.memberType === "api") {
    await db
      .update(imageBackendApi)
      .set(
        input.success
          ? {
              successCount: sql`${imageBackendApi.successCount} + 1`,
              lastError: null,
              lastErrorAt: null,
              cooldownUntil: null,
              updatedAt: now,
            }
          : {
              failCount: sql`${imageBackendApi.failCount} + 1`,
              ...(failure.status ? { status: failure.status } : {}),
              ...(failure.cooldownUntil !== undefined
                ? { cooldownUntil: failure.cooldownUntil }
                : {}),
              lastError: error,
              lastErrorAt: now,
              updatedAt: now,
            }
      )
      .where(eq(imageBackendApi.id, input.memberId));
    return;
  }

  const [account] = await db
    .select({
      implementationMode: imageBackendAccount.implementationMode,
      metadata: imageBackendAccount.metadata,
    })
    .from(imageBackendAccount)
    .where(eq(imageBackendAccount.id, input.memberId))
    .limit(1);
  const backend = normalizeAccountBackend(account?.implementationMode);
  const webSuccess =
    input.success && backend === "web"
      ? nextWebAccountMetadataAfterSuccess(account?.metadata)
      : null;

  await db
    .update(imageBackendAccount)
    .set(
      input.success
        ? {
            successCount: sql`${imageBackendAccount.successCount} + 1`,
            ...(webSuccess?.metadata !== undefined
              ? { metadata: webSuccess.metadata }
              : {}),
            ...(webSuccess?.status ? { status: webSuccess.status } : {}),
            lastError: null,
            lastErrorAt: null,
            cooldownUntil: webSuccess ? webSuccess.cooldownUntil : null,
            updatedAt: now,
          }
        : {
            failCount: sql`${imageBackendAccount.failCount} + 1`,
            ...(failure.status ? { status: failure.status } : {}),
            ...(failure.cooldownUntil !== undefined
              ? { cooldownUntil: failure.cooldownUntil }
              : {}),
            lastError: error,
            lastErrorAt: now,
            updatedAt: now,
          }
    )
    .where(eq(imageBackendAccount.id, input.memberId));
}

export async function refreshImageBackendAccountInfo(accountId: string) {
  const [account] = await db
    .select({
      id: imageBackendAccount.id,
      email: imageBackendAccount.email,
      accessToken: imageBackendAccount.accessToken,
      implementationMode: imageBackendAccount.implementationMode,
      model: imageBackendAccount.model,
      metadata: imageBackendAccount.metadata,
    })
    .from(imageBackendAccount)
    .where(eq(imageBackendAccount.id, accountId))
    .limit(1);

  if (!account) {
    throw new Error("账号不存在");
  }

  if (normalizeAccountBackend(account.implementationMode) !== "web") {
    throw new Error("只有 Web 账号支持远端额度刷新");
  }

  const now = new Date();
  try {
    const info = await getChatGptWebAccountInfo({
      baseUrl: "https://chatgpt.com",
      apiKey: account.accessToken,
      model: account.model || undefined,
      backend: {
        type: "pool-account",
        id: account.id,
        accountBackend: "web",
      },
    });
    await db
      .update(imageBackendAccount)
      .set({
        email: info.email || account.email,
        metadata: mergeWebAccountMetadata(account.metadata, info),
        status: "active",
        cooldownUntil:
          !info.imageQuotaUnknown && info.quota === 0
            ? parseMetadataDate(info.restoreAt)
            : null,
        lastError: null,
        lastErrorAt: null,
        updatedAt: now,
      })
      .where(eq(imageBackendAccount.id, account.id));
    return info;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "刷新账号远端信息失败";
    const failure = classifyFailure(message);
    await db
      .update(imageBackendAccount)
      .set({
        failCount: sql`${imageBackendAccount.failCount} + 1`,
        ...(failure.status ? { status: failure.status } : {}),
        ...(failure.cooldownUntil !== undefined
          ? { cooldownUntil: failure.cooldownUntil }
          : {}),
        lastError: truncateError(message),
        lastErrorAt: now,
        updatedAt: now,
      })
      .where(eq(imageBackendAccount.id, account.id));
    throw error;
  }
}

export async function listImageBackendGroupOptions(options?: {
  userSelectableOnly?: boolean;
}) {
  return await db
    .select({
      id: imageBackendGroup.id,
      name: imageBackendGroup.name,
      description: imageBackendGroup.description,
      isDefault: imageBackendGroup.isDefault,
      isUserSelectable: imageBackendGroup.isUserSelectable,
      isEnabled: imageBackendGroup.isEnabled,
      priority: imageBackendGroup.priority,
    })
    .from(imageBackendGroup)
    .where(
      options?.userSelectableOnly
        ? and(
            eq(imageBackendGroup.isEnabled, true),
            eq(imageBackendGroup.isUserSelectable, true)
          )
        : eq(imageBackendGroup.isEnabled, true)
    )
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt));
}

export async function listSelectableImageBackendGroups() {
  return await listImageBackendGroupOptions({ userSelectableOnly: true });
}

export async function getUserImageBackendPreference(userId: string) {
  const [preference] = await db
    .select({ groupId: userImageBackendPreference.groupId })
    .from(userImageBackendPreference)
    .where(eq(userImageBackendPreference.userId, userId))
    .limit(1);
  return preference?.groupId ?? null;
}

export async function setUserImageBackendPreference(
  userId: string,
  groupId: string | null
) {
  if (groupId) {
    const [group] = await db
      .select({ id: imageBackendGroup.id })
      .from(imageBackendGroup)
      .where(
        and(
          eq(imageBackendGroup.id, groupId),
          eq(imageBackendGroup.isEnabled, true),
          eq(imageBackendGroup.isUserSelectable, true)
        )
      )
      .limit(1);
    if (!group) throw new Error("生图分组不存在或不可选择");
  }

  const [existing] = await db
    .select({ id: userImageBackendPreference.id })
    .from(userImageBackendPreference)
    .where(eq(userImageBackendPreference.userId, userId))
    .limit(1);

  if (existing) {
    await db
      .update(userImageBackendPreference)
      .set({ groupId, updatedAt: new Date() })
      .where(eq(userImageBackendPreference.id, existing.id));
  } else {
    await db.insert(userImageBackendPreference).values({
      id: nanoid(),
      userId,
      groupId,
    });
  }
}

type UpsertGroupInput = {
  id?: string;
  name: string;
  description?: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  isUserSelectable: boolean;
  contentSafetyEnabled: boolean | null;
  priority: number;
};

export async function upsertImageBackendGroup(input: UpsertGroupInput) {
  if (input.isDefault) {
    await db.update(imageBackendGroup).set({
      isDefault: false,
      updatedAt: new Date(),
    });
  }

  if (input.id) {
    await db
      .update(imageBackendGroup)
      .set({
        name: input.name,
        description: input.description || null,
        isEnabled: input.isEnabled,
        isDefault: input.isDefault,
        isUserSelectable: input.isUserSelectable,
        contentSafetyEnabled: input.contentSafetyEnabled,
        priority: input.priority,
        updatedAt: new Date(),
      })
      .where(eq(imageBackendGroup.id, input.id));
    return input.id;
  }

  const id = nanoid();
  await db.insert(imageBackendGroup).values({
    id,
    name: input.name,
    description: input.description || null,
    isEnabled: input.isEnabled,
    isDefault: input.isDefault,
    isUserSelectable: input.isUserSelectable,
    contentSafetyEnabled: input.contentSafetyEnabled,
    priority: input.priority,
  });
  return id;
}

export async function deleteImageBackendGroup(groupId: string) {
  await db
    .delete(imageBackendGroup)
    .where(eq(imageBackendGroup.id, groupId));
}

type UpsertAccountInput = {
  id?: string;
  groupId?: string | null;
  name: string;
  email?: string | null;
  accessToken?: string;
  refreshToken?: string | null;
  implementationMode: ImageBackendAccountBackend;
  model?: string | null;
  contentSafetyEnabled: boolean;
  isEnabled: boolean;
  priority: number;
  concurrency: number;
  status?: string;
  metadata?: Record<string, unknown> | null;
};

export async function upsertImageBackendAccount(input: UpsertAccountInput) {
  const implementationMode = normalizeAccountBackend(input.implementationMode);
  const update = {
    groupId: input.groupId || null,
    name: input.name,
    email: input.email || null,
    refreshToken: input.refreshToken || null,
    implementationMode,
    model: input.model || null,
    contentSafetyEnabled: input.contentSafetyEnabled,
    isEnabled: input.isEnabled,
    priority: input.priority,
    concurrency: input.concurrency,
    status: input.status || "active",
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    updatedAt: new Date(),
  };

  if (input.id) {
    await db
      .update(imageBackendAccount)
      .set(
        input.accessToken
          ? {
              ...update,
              accessToken: input.accessToken,
              credentialHash: hashBackendCredential(input.accessToken),
            }
          : update
      )
      .where(eq(imageBackendAccount.id, input.id));
    return input.id;
  }

  if (!input.accessToken) {
    throw new Error("accessToken is required");
  }

  const credentialHash = hashBackendCredential(input.accessToken);
  const [existing] = await db
    .select({ id: imageBackendAccount.id })
    .from(imageBackendAccount)
    .where(
      and(
        eq(imageBackendAccount.credentialHash, credentialHash),
        eq(imageBackendAccount.implementationMode, implementationMode)
      )
    )
    .limit(1);
  if (existing) {
    await db
      .update(imageBackendAccount)
      .set({
        ...update,
        accessToken: input.accessToken,
        credentialHash,
      })
      .where(eq(imageBackendAccount.id, existing.id));
    return existing.id;
  }

  const id = nanoid();
  await db.insert(imageBackendAccount).values({
    id,
    ...update,
    accessToken: input.accessToken,
    credentialHash,
  });
  return id;
}

type Sub2ApiTokenSyncMode = "web" | "responses" | "both";

export type Sub2ApiSourceGroupSummary = {
  id: string;
  name: string;
  platform: string | null;
  accountCount: number;
};

type Sub2ApiAccountRow = {
  id: number | string;
  name: string | null;
  platform: string | null;
  type: string | null;
  status: string | null;
  schedulable: boolean | null;
  credentials: Record<string, unknown> | null;
  priority: number | null;
  concurrency: number | null;
  group_names: string[] | null;
};

type Sub2ApiTokenAccount = {
  sourceId: string;
  name: string | null;
  email: string | null;
  codexAccessToken: string | null;
  refreshToken: string | null;
  clientId: string | null;
  priority: number | null;
  concurrency: number | null;
  planType: string | null;
  groupNames: string[];
};

type Sub2ApiSourceGroupRow = {
  id: number | string;
  name: string;
  platform: string | null;
  account_count: number | string | null;
};

function credentialString(
  credentials: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  for (const key of keys) {
    const value = credentials?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
}

function mapSub2ApiAccountRow(row: Sub2ApiAccountRow): Sub2ApiTokenAccount | null {
  const credentials = row.credentials || {};
  const codexAccessToken = credentialString(credentials, [
    "access_token",
    "accessToken",
    "token",
  ]);
  const refreshToken = credentialString(credentials, [
    "refresh_token",
    "refreshToken",
  ]);
  if (!codexAccessToken && !refreshToken) return null;

  const clientId = credentialString(credentials, ["client_id", "clientId"]);
  const email = credentialString(credentials, ["email", "account_email", "username"]);
  const planType = credentialString(credentials, ["plan_type", "planType"]);
  const sourceId = String(row.id);
  const name = row.name?.trim() || email || `Sub2API 账号 ${sourceId}`;

  return {
    sourceId,
    name,
    email: email || null,
    codexAccessToken: codexAccessToken || null,
    refreshToken: refreshToken || null,
    clientId: clientId || null,
    priority: row.priority,
    concurrency: row.concurrency,
    planType: planType || null,
    groupNames: asStringArray(row.group_names),
  };
}

async function getSub2ApiPostgresConnectionString() {
  const connectionString =
    (await getRuntimeSettingString("SUB2API_POSTGRES_URL")) ||
    process.env.SUB2API_POSTGRES_URL?.trim();
  if (!connectionString) {
    throw new Error("请先配置 SUB2API_POSTGRES_URL");
  }
  return connectionString;
}

function createSub2ApiPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
  });
}

async function listSub2ApiCurrentAccessTokens(
  pool: Pool,
  options: { limit: number; sourceGroupId?: string | null }
) {
  const sourceGroupId = options.sourceGroupId
    ? Number(options.sourceGroupId)
    : null;
  if (options.sourceGroupId && !Number.isFinite(sourceGroupId)) {
    throw new Error("Sub2API 来源分组无效");
  }
  const result = await pool.query<Sub2ApiAccountRow>(
    `
      SELECT
        a.id,
        a.name,
        a.platform,
        a.type,
        a.status,
        a.schedulable,
        a.credentials,
        a.priority,
        a.concurrency,
        COALESCE(
          ARRAY_AGG(g.name ORDER BY ag.priority, g.name)
            FILTER (WHERE g.name IS NOT NULL),
          ARRAY[]::text[]
        ) AS group_names
      FROM accounts a
      LEFT JOIN account_groups ag ON ag.account_id = a.id
      LEFT JOIN groups g ON g.id = ag.group_id AND g.deleted_at IS NULL
      WHERE
        a.deleted_at IS NULL
        AND a.platform = 'openai'
        AND a.type = 'oauth'
        AND a.status = 'active'
        AND COALESCE(a.schedulable, true) = true
        AND (
          a.credentials ? 'access_token'
          OR a.credentials ? 'accessToken'
          OR a.credentials ? 'token'
          OR a.credentials ? 'refresh_token'
          OR a.credentials ? 'refreshToken'
        )
        AND ($2::bigint IS NULL OR EXISTS (
          SELECT 1
          FROM account_groups source_ag
          WHERE source_ag.account_id = a.id
            AND source_ag.group_id = $2::bigint
        ))
      GROUP BY a.id
      ORDER BY a.priority ASC, a.last_used_at ASC NULLS FIRST, a.id ASC
      LIMIT $1
    `,
    [options.limit, sourceGroupId]
  );
  return result.rows
    .map(mapSub2ApiAccountRow)
    .filter((account): account is Sub2ApiTokenAccount => Boolean(account));
}

async function listSub2ApiSourceGroupsFromPool(pool: Pool) {
  const result = await pool.query<Sub2ApiSourceGroupRow>(
    `
      SELECT
        g.id,
        g.name,
        g.platform,
        COUNT(a.id) FILTER (
          WHERE
            a.deleted_at IS NULL
            AND a.platform = 'openai'
            AND a.type = 'oauth'
            AND a.status = 'active'
            AND COALESCE(a.schedulable, true) = true
        ) AS account_count
      FROM groups g
      LEFT JOIN account_groups ag ON ag.group_id = g.id
      LEFT JOIN accounts a ON a.id = ag.account_id
      WHERE
        g.deleted_at IS NULL
        AND g.status = 'active'
        AND g.platform = 'openai'
      GROUP BY g.id, g.name, g.platform, g.sort_order
      ORDER BY g.sort_order ASC, g.name ASC, g.id ASC
    `
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    platform: row.platform,
    accountCount: Number(row.account_count || 0),
  }));
}

export async function listSub2ApiSourceGroups() {
  const connectionString = await getSub2ApiPostgresConnectionString();
  const pool = createSub2ApiPool(connectionString);
  try {
    return await listSub2ApiSourceGroupsFromPool(pool);
  } finally {
    await pool.end();
  }
}

type OpenAITokenRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

async function refreshOpenAIAccessToken(
  refreshToken: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const form = new URLSearchParams();
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", refreshToken);
    form.set("client_id", clientId);
    form.set("scope", OPENAI_REFRESH_SCOPES);

    const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          clientId === OPENAI_CODEX_OAUTH_CLIENT_ID
            ? "codex-cli/0.91.0"
            : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      },
      body: form.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OpenAI token refresh failed: HTTP ${response.status}${text ? ` ${text.slice(0, 300)}` : ""}`
      );
    }
    const payload = (await response.json()) as OpenAITokenRefreshResponse;
    const accessToken = payload.access_token?.trim();
    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken: payload.refresh_token?.trim() || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeBackSub2ApiRefreshToken(
  pool: Pool,
  sourceId: string,
  refreshToken: string
) {
  const numericSourceId = Number(sourceId);
  if (!Number.isFinite(numericSourceId)) {
    throw new Error(`Sub2API 账号 ID 非数字: ${sourceId}`);
  }
  await pool.query(
    `
      UPDATE accounts
      SET
        credentials = COALESCE(credentials, '{}'::jsonb)
          || jsonb_build_object('refresh_token', $2::text),
        updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [numericSourceId, refreshToken]
  );
}

async function resolveSub2ApiAccessTokenForMode(
  pool: Pool,
  account: Sub2ApiTokenAccount,
  mode: ImageBackendAccountBackend
) {
  if (mode === "responses") {
    return {
      accessToken: account.codexAccessToken,
      tokenSource: "sub2api.credentials.access_token",
      refreshTokenWrittenBack: false,
    };
  }

  if (!account.refreshToken) {
    return {
      accessToken: null,
      tokenSource: "sub2api.credentials.refresh_token",
      refreshTokenWrittenBack: false,
    };
  }

  const refreshed = await refreshOpenAIAccessToken(
    account.refreshToken,
    OPENAI_PLATFORM_OAUTH_CLIENT_ID
  );
  if (!refreshed?.accessToken) {
    return {
      accessToken: null,
      tokenSource: "openai.oauth.platform_refresh",
      refreshTokenWrittenBack: false,
    };
  }
  const shouldWriteBack =
    Boolean(refreshed.refreshToken) &&
    refreshed.refreshToken !== account.refreshToken;
  if (shouldWriteBack && refreshed.refreshToken) {
    await writeBackSub2ApiRefreshToken(
      pool,
      account.sourceId,
      refreshed.refreshToken
    );
  }
  return {
    accessToken: refreshed.accessToken,
    tokenSource: "openai.oauth.platform_refresh",
    refreshTokenWrittenBack: shouldWriteBack,
  };
}

export async function syncImageBackendAccountsFromSub2Api(input: {
  webGroupId?: string | null;
  responsesGroupId?: string | null;
  sourceGroupId?: string | null;
  syncMode: Sub2ApiTokenSyncMode;
  contentSafetyEnabled: boolean;
  limit?: number | null;
}) {
  const configuredLimit = await getRuntimeSettingNumber(
    "SUB2API_POSTGRES_SYNC_LIMIT",
    100,
    { positive: true }
  );
  const limit = Math.max(
    1,
    Math.min(500, Math.trunc(input.limit || configuredLimit))
  );
  const modes =
    input.syncMode === "both"
      ? (["web", "responses"] as const)
      : ([input.syncMode] as const);
  const imported: string[] = [];
  const skipped = {
    web: 0,
    responses: 0,
  };
  let failed = 0;
  let refreshTokenWriteBackCount = 0;

  const connectionString = await getSub2ApiPostgresConnectionString();
  const pool = createSub2ApiPool(connectionString);
  try {
    const accounts = await listSub2ApiCurrentAccessTokens(pool, {
      limit,
      sourceGroupId: input.sourceGroupId,
    });
    for (const account of accounts) {
      for (const mode of modes) {
        try {
          const { accessToken, tokenSource, refreshTokenWrittenBack } =
            await resolveSub2ApiAccessTokenForMode(pool, account, mode);
          if (!accessToken) {
            skipped[mode]++;
            continue;
          }
          if (refreshTokenWrittenBack) refreshTokenWriteBackCount++;
          const id = await upsertImageBackendAccount({
            groupId:
              mode === "responses" ? input.responsesGroupId : input.webGroupId,
            name:
              mode === "responses"
                ? `${account.name} / Codex`
                : `${account.name} / Web`,
            email: account.email,
            accessToken,
            refreshToken: null,
            implementationMode: mode,
            model: null,
            contentSafetyEnabled: input.contentSafetyEnabled,
            isEnabled: true,
            priority: account.priority ?? 50,
            concurrency: Math.max(1, Math.min(100, account.concurrency ?? 1)),
            status: "active",
            metadata: {
              source: "sub2api_postgres",
              sourceAccountId: account.sourceId,
              sourceGroups: account.groupNames,
              planType: account.planType,
              syncedAt: new Date().toISOString(),
              tokenSource,
              sub2apiClientId: account.clientId,
              refreshTokenWrittenBack,
            },
          });
          imported.push(id);
        } catch (error) {
          failed++;
          skipped[mode]++;
          logWarn("Sub2API 账号 AT 同步失败，已跳过", {
            sourceAccountId: account.sourceId,
            mode,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      sourceCount: accounts.length,
      syncedCount: imported.length,
      skipped,
      failed,
      refreshTokenWriteBackCount,
    };
  } finally {
    await pool.end();
  }
}

export async function refreshStaleWebBackendAccounts(options?: {
  staleMinutes?: number;
  limit?: number;
}) {
  const staleMinutes = Math.max(1, Math.trunc(options?.staleMinutes ?? 30));
  const limit = Math.max(1, Math.min(200, Math.trunc(options?.limit ?? 20)));
  const threshold = new Date(Date.now() - staleMinutes * 60_000);
  const now = new Date();
  const candidates = await db
    .select({
      id: imageBackendAccount.id,
      metadata: imageBackendAccount.metadata,
      cooldownUntil: imageBackendAccount.cooldownUntil,
      lastErrorAt: imageBackendAccount.lastErrorAt,
    })
    .from(imageBackendAccount)
    .where(
      and(
        eq(imageBackendAccount.implementationMode, "web"),
        eq(imageBackendAccount.isEnabled, true),
        or(
          eq(imageBackendAccount.status, "active"),
          eq(imageBackendAccount.status, "limited")
        ),
        or(
          isNull(imageBackendAccount.cooldownUntil),
          sql`${imageBackendAccount.cooldownUntil} <= ${now}`
        )
      )
    )
    .orderBy(asc(imageBackendAccount.lastErrorAt), asc(imageBackendAccount.lastUsedAt))
    .limit(limit * 3);

  const selected = candidates
    .filter((account) => {
      const info = normalizeWebAccountMetadata(account.metadata);
      if (!info?.refreshedAt) return true;
      return new Date(info.refreshedAt).getTime() <= threshold.getTime();
    })
    .slice(0, limit);

  const results = [];
  for (const account of selected) {
    try {
      const info = await refreshImageBackendAccountInfo(account.id);
      results.push({
        id: account.id,
        success: true,
        quota: info.quota,
        imageQuotaUnknown: info.imageQuotaUnknown,
      });
    } catch (error) {
      results.push({
        id: account.id,
        success: false,
        error: error instanceof Error ? error.message : "刷新失败",
      });
    }
  }

  return {
    scanned: candidates.length,
    processed: selected.length,
    results,
  };
}

type UpsertApiInput = {
  id?: string;
  groupId?: string | null;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model?: string | null;
  useStream: boolean;
  contentSafetyEnabled: boolean;
  isEnabled: boolean;
  priority: number;
  status?: string;
};

export async function upsertImageBackendApi(input: UpsertApiInput) {
  const update = {
    groupId: input.groupId || null,
    name: input.name,
    baseUrl: stripTrailingSlash(input.baseUrl),
    model: input.model || null,
    useStream: input.useStream,
    contentSafetyEnabled: input.contentSafetyEnabled,
    isEnabled: input.isEnabled,
    priority: input.priority,
    status: input.status || "active",
    updatedAt: new Date(),
  };

  if (input.id) {
    await db
      .update(imageBackendApi)
      .set(input.apiKey ? { ...update, apiKey: input.apiKey } : update)
      .where(eq(imageBackendApi.id, input.id));
    return input.id;
  }

  if (!input.apiKey) {
    throw new Error("apiKey is required");
  }

  const id = nanoid();
  await db.insert(imageBackendApi).values({
    id,
    ...update,
    apiKey: input.apiKey,
  });
  return id;
}

export async function deleteImageBackendMembers(input: {
  accountIds?: string[];
  apiIds?: string[];
}) {
  if (input.accountIds?.length) {
    await db
      .delete(imageBackendAccount)
      .where(inArray(imageBackendAccount.id, input.accountIds));
  }
  if (input.apiIds?.length) {
    await db
      .delete(imageBackendApi)
      .where(inArray(imageBackendApi.id, input.apiIds));
  }
}

export async function listAdminImageBackendPool() {
  const groups = await db
    .select()
    .from(imageBackendGroup)
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt));
  const accountCounts = await db
    .select({ groupId: imageBackendAccount.groupId, value: count() })
    .from(imageBackendAccount)
    .groupBy(imageBackendAccount.groupId);
  const apiCounts = await db
    .select({ groupId: imageBackendApi.groupId, value: count() })
    .from(imageBackendApi)
    .groupBy(imageBackendApi.groupId);
  const accountCountMap = new Map(
    accountCounts.map((item) => [item.groupId, Number(item.value)])
  );
  const apiCountMap = new Map(
    apiCounts.map((item) => [item.groupId, Number(item.value)])
  );

  const summaries: ImageBackendGroupSummary[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    isEnabled: group.isEnabled,
    isDefault: group.isDefault,
    isUserSelectable: group.isUserSelectable,
    contentSafetyEnabled: group.contentSafetyEnabled,
    priority: group.priority,
    apiCount: apiCountMap.get(group.id) ?? 0,
    accountCount: accountCountMap.get(group.id) ?? 0,
  }));

  const accounts = await db
    .select({
      id: imageBackendAccount.id,
      groupId: imageBackendAccount.groupId,
      name: imageBackendAccount.name,
      email: imageBackendAccount.email,
      implementationMode: imageBackendAccount.implementationMode,
      model: imageBackendAccount.model,
      contentSafetyEnabled: imageBackendAccount.contentSafetyEnabled,
      isEnabled: imageBackendAccount.isEnabled,
      priority: imageBackendAccount.priority,
      concurrency: imageBackendAccount.concurrency,
      status: imageBackendAccount.status,
      successCount: imageBackendAccount.successCount,
      failCount: imageBackendAccount.failCount,
      lastUsedAt: imageBackendAccount.lastUsedAt,
      cooldownUntil: imageBackendAccount.cooldownUntil,
      lastError: imageBackendAccount.lastError,
      lastErrorAt: imageBackendAccount.lastErrorAt,
      metadata: imageBackendAccount.metadata,
      createdAt: imageBackendAccount.createdAt,
    })
    .from(imageBackendAccount)
    .orderBy(asc(imageBackendAccount.priority), desc(imageBackendAccount.createdAt));

  const apis = await db
    .select({
      id: imageBackendApi.id,
      groupId: imageBackendApi.groupId,
      name: imageBackendApi.name,
      baseUrl: imageBackendApi.baseUrl,
      model: imageBackendApi.model,
      interfaceMode: imageBackendApi.interfaceMode,
      useStream: imageBackendApi.useStream,
      contentSafetyEnabled: imageBackendApi.contentSafetyEnabled,
      isEnabled: imageBackendApi.isEnabled,
      priority: imageBackendApi.priority,
      status: imageBackendApi.status,
      successCount: imageBackendApi.successCount,
      failCount: imageBackendApi.failCount,
      lastUsedAt: imageBackendApi.lastUsedAt,
      cooldownUntil: imageBackendApi.cooldownUntil,
      lastError: imageBackendApi.lastError,
      lastErrorAt: imageBackendApi.lastErrorAt,
      createdAt: imageBackendApi.createdAt,
    })
    .from(imageBackendApi)
    .orderBy(asc(imageBackendApi.priority), desc(imageBackendApi.createdAt));

  return {
    groups: summaries,
    accounts,
    apis,
  };
}
