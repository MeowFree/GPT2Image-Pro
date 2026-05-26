import { createHash } from "node:crypto";
import { db } from "@repo/database";
import {
  externalApiKey,
  imageBackendAccount,
  imageBackendAccountGroup,
  imageBackendApi,
  imageBackendGroup,
  systemSetting,
  userImageBackendPreference,
} from "@repo/database/schema";
import {
  isPlanAtLeast,
  normalizeSubscriptionPlan,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { validateNestedGroupConfig } from "@repo/shared/image-backend/nested-groups";
import { logWarn } from "@repo/shared/logger";
import { canUsePlanCapability } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import {
  clearSystemSettingsCache,
  getRuntimeSettingJson,
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
  getRuntimeSettingSelect,
  getRuntimeSettingString,
} from "@repo/shared/system-settings";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { Pool } from "pg";

import {
  type ChatGptWebAccountInfo,
  getChatGptWebAccountInfo,
} from "@/features/image-generation/chatgpt-web";
import type { ApiConfig } from "@/features/image-generation/types";

import {
  imageBackendApiInterfaceAllowsRequest,
  imageBackendApiUsesResponsesEndpoint,
  normalizeImageBackendApiInterfaceMode,
} from "./api-interface-mode";
import {
  getEffectiveBillingMultiplierForSelectedGroup,
  getGroupBillingMultiplier,
} from "./group-billing";
import { parseImportTokensText } from "./import-token-parser";
import type {
  ContentSafetyOverride,
  ImageBackendApiInterfaceMode,
  ImageBackendAccountBackend,
  ImageBackendGroupBackendType,
  ImageBackendGroupSummary,
  ImageBackendPreferenceMode,
  ImageBackendRequestKind,
} from "./types";

const MANUAL_TOKEN_IMPORT_LIMIT = 10_000;

type ResolveBackendOptions = {
  userId: string;
  apiKeyId?: string;
  requestKind: ImageBackendRequestKind;
  preferredMemberId?: string;
  accountBackendPreference?: ImageBackendAccountBackend;
  accountBackendPreferenceMode?: ImageBackendPreferenceMode;
};

type PoolMember =
  | {
      type: "api";
      id: string;
      groupId: string | null;
      groupMetadata: Record<string, unknown> | null;
      groupContentSafetyEnabled: boolean | null;
      name: string;
      baseUrl: string;
      apiKey: string;
      model: string | null;
      interfaceMode: ImageBackendApiInterfaceMode;
      useStream: boolean;
      contentSafetyEnabled: boolean;
      priority: number;
      concurrency: number;
      lastUsedAt: Date | null;
      createdAt: Date;
    }
  | {
      type: "account";
      id: string;
      groupId: string | null;
      groupIds: string[];
      groupMetadata: Record<string, unknown> | null;
      groupContentSafetyEnabled: boolean | null;
      name: string;
      accessToken: string;
      model: string | null;
      implementationMode: string;
      contentSafetyEnabled: boolean;
      priority: number;
      concurrency: number;
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

export class ImageBackendPoolUnavailableError extends Error {
  constructor(message = "当前生图后端分组没有可用账号或 API") {
    super(message);
    this.name = "ImageBackendPoolUnavailableError";
  }
}

export type ImageBackendReportResultInput = {
  memberType?: "api" | "account";
  memberId?: string;
  success: boolean;
  error?: string | null;
  upstreamResetAt?: string | Date | null;
  retryAfterSeconds?: number | null;
};

export type ImageBackendReportResultOutcome = {
  success: boolean;
  status?: string;
  cooldownUntil?: Date | null;
  retryable: boolean;
  switchable: boolean;
};

type WebAccountRuntimeMetadata = ChatGptWebAccountInfo & {
  refreshedAt?: string;
};

type BackendMetadata = Record<string, unknown> & {
  source?: string;
  chatgptAccountId?: string;
  webAccount?: Partial<WebAccountRuntimeMetadata>;
};

type ImageBackendGroupMetadata = Record<string, unknown> & {
  minPlan?: unknown;
  backendType?: unknown;
  childGroupIds?: unknown;
  billingMultiplier?: unknown;
  creditMultiplier?: unknown;
  costMultiplier?: unknown;
};

type SelectableGroupContext = {
  id: string;
  metadata: Record<string, unknown> | null;
  contentSafetyEnabled: boolean | null;
};

const CHATGPT_CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex";
const CODEX_CLI_VERSION = "0.125.0";
const CODEX_CLI_USER_AGENT = `codex_cli_rs/${CODEX_CLI_VERSION}`;
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_PLATFORM_OAUTH_CLIENT_ID = "app_2SKx67EdpoN0G6j64rFvigXD";
const OPENAI_MOBILE_RT_CLIENT_ID = "app_LlGpXReQgckcGGUo2JrYvtJK";
const OPENAI_REFRESH_SCOPES = "openid profile email";
const AUTO_SUB2API_SYNC_STATE_KEY = "SUB2API_AUTO_SYNC_STATE";
const AUTO_SUB2API_SYNC_TASKS_KEY = "SUB2API_AUTO_SYNC_TASKS";
const DEFAULT_BACKEND_COOLDOWN_MINUTES = 15;
const MAX_PARSED_RESET_COOLDOWN_DAYS = 14;
const DEFAULT_UNRECOVERABLE_BACKEND_ERROR_KEYWORDS = [
  "refresh token",
  "invalid refresh token",
  "invalid_refresh_token",
  "invalid_grant",
  "authentication",
  "authentication failed",
  "token_invalidated",
  "token_revoked",
  "account deactivated",
  "deactivated account",
  "deactivated_workspace",
  "workspace deactivated",
  "organization has been disabled",
  "identity verification is required",
];
const backendInflight = new Map<string, number>();

function normalizeAccountBackend(
  value?: string | null
): ImageBackendAccountBackend {
  return value === "responses" ? "responses" : "web";
}

function normalizeGroupBackendType(
  value?: unknown
): ImageBackendGroupBackendType {
  return value === "web" || value === "responses" ? value : "mixed";
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

function asGroupMetadata(
  metadata: Record<string, unknown> | null | undefined
): ImageBackendGroupMetadata {
  return metadata && typeof metadata === "object" ? metadata : {};
}

function getGroupMinPlan(
  metadata: Record<string, unknown> | null | undefined
): SubscriptionPlan {
  return normalizeSubscriptionPlan(asGroupMetadata(metadata).minPlan, "free");
}

function getGroupBackendType(
  metadata: Record<string, unknown> | null | undefined
) {
  return normalizeGroupBackendType(asGroupMetadata(metadata).backendType);
}

function normalizeGroupChildGroupIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    )
  );
}

function getGroupChildGroupIds(
  metadata: Record<string, unknown> | null | undefined
) {
  return normalizeGroupChildGroupIds(asGroupMetadata(metadata).childGroupIds);
}

function normalizeAccountGroupIds(
  groupIds?: readonly (string | null | undefined)[] | null
) {
  if (!groupIds) return [];
  return Array.from(
    new Set(
      groupIds
        .map((groupId) => (typeof groupId === "string" ? groupId.trim() : ""))
        .filter((groupId) => groupId && groupId !== "default")
    )
  );
}

function accountGroupIdsFromInput(input: {
  groupId?: string | null;
  groupIds?: string[] | null;
}) {
  if (input.groupIds !== undefined) {
    return normalizeAccountGroupIds(input.groupIds);
  }
  return normalizeAccountGroupIds(input.groupId ? [input.groupId] : []);
}

function groupBackendAllowsRequest(
  metadata: Record<string, unknown> | null | undefined,
  requestKind: ImageBackendRequestKind
) {
  const backendType = getGroupBackendType(metadata);
  if (requestKind === "responses") {
    return backendType === "responses" || backendType === "mixed";
  }
  return true;
}

function groupBackendAllowsAccount(
  metadata: Record<string, unknown> | null | undefined,
  backend: ImageBackendAccountBackend
) {
  const backendType = getGroupBackendType(metadata);
  return backendType === "mixed" || backendType === backend;
}

function resolveEffectiveAccountBackendPreference(
  metadata: Record<string, unknown> | null | undefined,
  preference?: ImageBackendAccountBackend,
  mode?: ImageBackendPreferenceMode
) {
  if (!preference) return undefined;
  if (mode === "mixed-only" && getGroupBackendType(metadata) !== "mixed") {
    return undefined;
  }
  return preference;
}

function accountBackendAllowsRequest(
  backend: ImageBackendAccountBackend,
  requestKind: ImageBackendRequestKind
) {
  if (requestKind === "responses") return backend === "responses";
  return true;
}

function canUseBackendGroupForPlan(
  metadata: Record<string, unknown> | null | undefined,
  plan: SubscriptionPlan
) {
  return isPlanAtLeast(plan, getGroupMinPlan(metadata));
}

function memberTimestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  return new Date(value).getTime();
}

function parseDurationMs(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?\s*ms$/.test(trimmed)) {
    return Number.parseFloat(trimmed) || null;
  }
  if (/^\d+(?:\.\d+)?\s*s$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 1000;
  }
  if (/^\d+(?:\.\d+)?\s*m$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 60_000;
  }
  if (/^\d+(?:\.\d+)?\s*h$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 60 * 60_000;
  }
  if (/^\d+(?:\.\d+)?\s*d(?:ay|ays)?$/.test(trimmed)) {
    return Number.parseFloat(trimmed) * 24 * 60 * 60_000;
  }
  const parts = [
    ...trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|day|days)/g),
  ];
  if (!parts.length) return null;
  const total = parts.reduce((sum, match) => {
    const amount = Number.parseFloat(match[1] || "0");
    const unit = match[2];
    if (unit === "ms") return sum + amount;
    if (unit === "s") return sum + amount * 1000;
    if (unit === "m") return sum + amount * 60_000;
    if (unit === "h") return sum + amount * 60 * 60_000;
    if (unit === "d" || unit === "day" || unit === "days") {
      return sum + amount * 24 * 60 * 60_000;
    }
    return sum;
  }, 0);
  return total > 0 ? total : null;
}

function backendKey(member: Pick<PoolMember, "type" | "id">) {
  return `${member.type}:${member.id}`;
}

function backendInflightCount(member: Pick<PoolMember, "type" | "id">) {
  return backendInflight.get(backendKey(member)) || 0;
}

function backendLoadRate(member: PoolMember) {
  return backendInflightCount(member) / Math.max(1, member.concurrency || 1);
}

function splitKeywordList(value?: string | null) {
  return (value || "")
    .split(/[\n,;，；]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function getUnrecoverableBackendErrorKeywords() {
  const configured = await getRuntimeSettingString(
    "IMAGE_BACKEND_UNRECOVERABLE_ERROR_KEYWORDS"
  );
  const keywords = splitKeywordList(configured);
  return keywords.length
    ? keywords
    : DEFAULT_UNRECOVERABLE_BACKEND_ERROR_KEYWORDS;
}

async function isUnrecoverableBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  if (!normalized) return false;
  const keywords = await getUnrecoverableBackendErrorKeywords();
  return keywords.some((keyword) => normalized.includes(keyword));
}

export function acquireImageBackendInflight(input: {
  memberType?: "api" | "account";
  memberId?: string;
}) {
  if (!input.memberType || !input.memberId) return;
  const key = `${input.memberType}:${input.memberId}`;
  backendInflight.set(key, (backendInflight.get(key) || 0) + 1);
}

export function releaseImageBackendInflight(input: {
  memberType?: "api" | "account";
  memberId?: string;
}) {
  if (!input.memberType || !input.memberId) return;
  const key = `${input.memberType}:${input.memberId}`;
  const current = backendInflight.get(key) || 0;
  if (current <= 1) {
    backendInflight.delete(key);
    return;
  }
  backendInflight.set(key, current - 1);
}

function isRecoverableBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    isUnsupportedModelBackendError(error) ||
    isTransientNetworkBackendError(error) ||
    normalized.includes("429") ||
    normalized.includes("529") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("usage limit") ||
    normalized.includes("usage_limit") ||
    normalized.includes("limit has been reached") ||
    normalized.includes("limit_reached") ||
    normalized.includes("rate_limit_exceeded") ||
    normalized.includes("no available image quota") ||
    normalized.includes("quota exhausted") ||
    normalized.includes("quota_exhausted") ||
    normalized.includes("daily quota exceeded") ||
    normalized.includes("account quota exceeded") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("quota_exceeded") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("insufficient credit") ||
    normalized.includes("insufficient credits") ||
    normalized.includes("not enough credit") ||
    normalized.includes("not enough credits") ||
    normalized.includes("credit exhausted") ||
    normalized.includes("credits exhausted") ||
    normalized.includes("resource has been exhausted") ||
    normalized.includes("minimumcreditamountforusage") ||
    normalized.includes("minimum credit amount for usage") ||
    normalized.includes("minimum credit") ||
    normalized.includes("billing_hard_limit") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("econnreset") ||
    normalized.includes("fetch failed") ||
    normalized.includes("empty non-json") ||
    normalized.includes("empty response") ||
    normalized.includes("non-json responses api response") ||
    normalized.includes("non-json images api response") ||
    normalized.includes("returned no image output") ||
    normalized.includes("api returned no image data") ||
    normalized.includes("http 500") ||
    normalized.includes("status_code=500") ||
    normalized.includes("status code 500") ||
    normalized.includes('"status":500') ||
    normalized.includes("internal server error") ||
    normalized.includes("server_error") ||
    normalized.includes("something seems to have gone wrong") ||
    normalized.includes("an error occurred while processing your request") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("server overloaded") ||
    normalized.includes("overloaded") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("temporary unavailable") ||
    normalized.includes("service unavailable")
  );
}

function isTransientNetworkBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized === "terminated" ||
    normalized.includes("typeerror: terminated") ||
    normalized.includes("request aborted") ||
    normalized.includes("operation was aborted") ||
    normalized.includes("socket closed") ||
    normalized.includes("socket hang up") ||
    normalized.includes("other side closed") ||
    normalized.includes("connection closed") ||
    normalized.includes("connection terminated") ||
    normalized.includes("connection reset") ||
    normalized.includes("econnreset") ||
    (normalized.includes("undici") && normalized.includes("terminated"))
  );
}

function isLocalAbortTimeoutError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("operation was aborted") &&
    normalized.includes("timeout")
  );
}

function isUserRequestBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("moderation_blocked") ||
    normalized.includes("safety_violations") ||
    normalized.includes("safety system") ||
    normalized.includes("image_generation_user_error") ||
    normalized.includes("user_error") ||
    normalized.includes("content_policy") ||
    normalized.includes("policy_violation")
  );
}

export function isImageBackendSwitchableError(error?: string | null) {
  return Boolean(
    error &&
      !isUserRequestBackendError(error) &&
      !isLocalAbortTimeoutError(error) &&
      (isRecoverableBackendError(error) ||
        isInvalidBackendCredentialError(error))
  );
}

function isClassifiedFailureRecoverable(
  error: string | null,
  failure: { status?: string; cooldownUntil?: Date | null }
) {
  return Boolean(
    error &&
      !isUserRequestBackendError(error) &&
      isRecoverableBackendError(error) &&
      failure.status !== "error"
  );
}

function isInvalidBackendCredentialError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("invalid api key") ||
    normalized.includes("invalid_api_key") ||
    normalized.includes("invalid access token") ||
    normalized.includes("invalid_access_token") ||
    normalized.includes("invalid auth") ||
    normalized.includes("invalid authentication") ||
    normalized.includes("authentication token has been invalidated") ||
    normalized.includes("token has been invalidated") ||
    normalized.includes("token expired") ||
    normalized.includes("expired token") ||
    normalized.includes("token is expired") ||
    normalized.includes("access token expired") ||
    normalized.includes("signing in again") ||
    normalized.includes("please sign in again") ||
    normalized.includes("please try signing in again")
  );
}

function isUsageLimitBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("usage limit") ||
    normalized.includes("usage_limit") ||
    normalized.includes("limit has been reached") ||
    normalized.includes("limit_reached") ||
    normalized.includes("no available image quota") ||
    normalized.includes("quota exhausted") ||
    normalized.includes("quota_exhausted") ||
    normalized.includes("daily quota exceeded") ||
    normalized.includes("account quota exceeded") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("quota exceeded") ||
    normalized.includes("quota_exceeded") ||
    normalized.includes("insufficient credit") ||
    normalized.includes("insufficient credits") ||
    normalized.includes("not enough credit") ||
    normalized.includes("not enough credits") ||
    normalized.includes("credit exhausted") ||
    normalized.includes("credits exhausted") ||
    normalized.includes("resource has been exhausted") ||
    normalized.includes("minimumcreditamountforusage") ||
    normalized.includes("minimum credit amount for usage") ||
    normalized.includes("minimum credit") ||
    normalized.includes("billing_hard_limit")
  );
}

function isResetAwareLimitedBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    isUsageLimitBackendError(error) ||
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  );
}

function isOverloadBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("529") ||
    normalized.includes("overloaded") ||
    normalized.includes("server overloaded") ||
    normalized.includes("http 500") ||
    normalized.includes("status_code=500") ||
    normalized.includes("status code 500") ||
    normalized.includes('"status":500') ||
    normalized.includes("internal server error") ||
    normalized.includes("server_error") ||
    normalized.includes("something seems to have gone wrong") ||
    normalized.includes("an error occurred while processing your request") ||
    normalized.includes("empty non-json") ||
    normalized.includes("empty response") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("temporary unavailable") ||
    normalized.includes("service unavailable") ||
    normalized.includes("capacity") ||
    normalized.includes("try again later")
  );
}

function isUnsupportedModelBackendError(error?: string | null) {
  const normalized = (error || "").toLowerCase();
  return (
    normalized.includes("unsupported model") ||
    normalized.includes("model not supported") ||
    normalized.includes("model is not supported") ||
    normalized.includes("model_not_supported") ||
    normalized.includes("unsupported_model") ||
    normalized.includes("model_not_found") ||
    normalized.includes("model_not_available") ||
    normalized.includes("does not support this model") ||
    normalized.includes("not support this model") ||
    normalized.includes("tool choice 'image_generation' not found") ||
    normalized.includes("tool choice image_generation not found") ||
    (normalized.includes("image_generation") &&
      normalized.includes("not found in") &&
      normalized.includes("tools")) ||
    normalized.includes("not allowed to use model") ||
    normalized.includes("not have access to the model") ||
    normalized.includes("account does not support") ||
    normalized.includes("账户不支持此模型") ||
    normalized.includes("不支持此模型") ||
    normalized.includes("不支持该模型")
  );
}

function parseDateValue(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const durationMs = parseDurationMs(trimmed);
  if (durationMs) {
    return new Date(Date.now() + durationMs);
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampResetDate(date: Date | null, now: Date) {
  if (!date || date.getTime() <= now.getTime()) return null;
  const max = now.getTime() + MAX_PARSED_RESET_COOLDOWN_DAYS * 24 * 60 * 60_000;
  return new Date(Math.min(date.getTime(), max));
}

function parseResetDateFromError(error?: string | null) {
  if (!error) return null;
  const normalized = error.replace(/\\"/g, '"');
  const retryAfter = normalized.match(/retry-after["'\s:=]+(\d{1,8})/i)?.[1];
  if (retryAfter) {
    return new Date(Date.now() + Number(retryAfter) * 1000);
  }
  const retryAfterSeconds = normalized.match(
    /(?:retryAfterSeconds|retry_after_seconds|retry_after|retryAfter|reset_after_seconds|resets_in_seconds|quotaResetDelay)["'\s:=]+([^"',}\]\s]+)/i
  )?.[1];
  if (retryAfterSeconds) {
    const numeric = Number(retryAfterSeconds);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(Date.now() + numeric * 1000);
    }
    const durationMs = parseDurationMs(retryAfterSeconds);
    if (durationMs) return new Date(Date.now() + durationMs);
  }

  const relativeResetMatch = normalized.match(
    /(?:reset_after|resetAfter|restore_after|restoreAfter)["'\s:=]+([^"',}\]\s]+)/i
  )?.[1];
  if (relativeResetMatch) {
    const numeric = Number(relativeResetMatch);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(Date.now() + numeric * 1000);
    }
    const durationMs = parseDurationMs(relativeResetMatch);
    if (durationMs) return new Date(Date.now() + durationMs);
  }

  const resetMatch = normalized.match(
    /(?:x-ratelimit-reset(?:-[a-z0-9_-]+)?|upstreamResetAt|upstream_reset_at|resetAt|reset_at|resetsAt|resets_at|restore_at|restoreAt)["'\s:=]+([^"',}\]\s]+)/i
  )?.[1];
  if (resetMatch) {
    const parsed = parseDateValue(resetMatch);
    if (parsed) return parsed;
  }

  const proseMatch = normalized.match(
    /(?:reset|resets|restore|available again|try again)(?:\s+\w+){0,4}\s+(?:at|after|on|in)[:\s]+([^"',}\]\n]+)/i
  )?.[1];
  return parseDateValue(proseMatch);
}

function resolveCooldownDate(
  error: string | null,
  fallback: Date | null,
  input?: Pick<
    ImageBackendReportResultInput,
    "upstreamResetAt" | "retryAfterSeconds"
  >,
  options?: { useUpstreamReset?: boolean }
) {
  if (!options?.useUpstreamReset) return fallback;

  const now = new Date();
  const retryAfter = Number(input?.retryAfterSeconds);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    const parsed = clampResetDate(
      new Date(now.getTime() + retryAfter * 1000),
      now
    );
    if (parsed) return parsed;
  }
  const explicitReset = clampResetDate(
    parseDateValue(input?.upstreamResetAt),
    now
  );
  if (explicitReset) return explicitReset;
  const bodyReset = clampResetDate(parseResetDateFromError(error), now);
  if (bodyReset) return bodyReset;
  return fallback;
}

function cooldownFromMinutes(minutes: number) {
  return new Date(Date.now() + Math.max(1, minutes) * 60_000);
}

function isMeaningfulSourceCooldownForError(
  error: string | null,
  cooldownUntil: Date | null
) {
  return Boolean(
    cooldownUntil &&
      cooldownUntil.getTime() > Date.now() &&
      isResetAwareLimitedBackendError(error)
  );
}

async function getBackendCooldownMinutes(
  key:
    | "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES"
    | "IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES"
    | "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES"
    | "IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES"
    | "IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES"
    | "IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES"
) {
  const defaultMinutes = await getRuntimeSettingNumber(
    "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES",
    DEFAULT_BACKEND_COOLDOWN_MINUTES,
    { positive: true }
  );
  if (key === "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES") {
    return defaultMinutes;
  }
  return await getRuntimeSettingNumber(key, defaultMinutes, { positive: true });
}

async function classifyFailure(
  error?: string | null,
  input?: Pick<
    ImageBackendReportResultInput,
    "upstreamResetAt" | "retryAfterSeconds"
  >
): Promise<{
  status?: string;
  cooldownUntil?: Date | null;
}> {
  const normalized = (error || "").toLowerCase();
  if (isUserRequestBackendError(error)) {
    return {};
  }
  if (
    (await isUnrecoverableBackendError(error)) ||
    isInvalidBackendCredentialError(error)
  ) {
    return { status: "error", cooldownUntil: null };
  }
  if (isUsageLimitBackendError(error)) {
    const minutes = await getBackendCooldownMinutes(
      "IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES"
    );
    return {
      status: "limited",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input,
        { useUpstreamReset: true }
      ),
    };
  }
  if (isUnsupportedModelBackendError(error)) {
    const minutes = await getBackendCooldownMinutes(
      "IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input
      ),
    };
  }
  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    const minutes = await getBackendCooldownMinutes(
      "IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input,
        { useUpstreamReset: true }
      ),
    };
  }
  if (isOverloadBackendError(error)) {
    const minutes = await getBackendCooldownMinutes(
      "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input
      ),
    };
  }
  if (isRecoverableBackendError(error)) {
    const minutes = await getBackendCooldownMinutes(
      "IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil: resolveCooldownDate(
        error || null,
        cooldownFromMinutes(minutes),
        input
      ),
    };
  }
  const minutes = await getBackendCooldownMinutes(
    "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES"
  );
  return {
    status: "active",
    cooldownUntil: cooldownFromMinutes(minutes),
  };
}

function isBackendAvailableStatus(
  statusColumn:
    | typeof imageBackendAccount.status
    | typeof imageBackendApi.status,
  cooldownColumn:
    | typeof imageBackendAccount.cooldownUntil
    | typeof imageBackendApi.cooldownUntil,
  now: Date
) {
  return or(
    eq(statusColumn, "active"),
    and(eq(statusColumn, "limited"), sql`${cooldownColumn} <= ${now}`)
  );
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

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string
) {
  const value = asBackendMetadata(metadata)[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isSub2ApiBackedMetadata(
  metadata: Record<string, unknown> | null | undefined
) {
  return asBackendMetadata(metadata).source === "sub2api_postgres";
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
    limitsProgress: Array.isArray(raw.limitsProgress) ? raw.limitsProgress : [],
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

async function getDefaultGroupId() {
  const [defaultGroup] = await db
    .select({ id: imageBackendGroup.id })
    .from(imageBackendGroup)
    .where(
      and(
        eq(imageBackendGroup.isEnabled, true),
        eq(imageBackendGroup.isDefault, true)
      )
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

async function resolveRequestedGroup(
  options: ResolveBackendOptions
): Promise<{ groupId: string | null; explicit: boolean }> {
  if (options.apiKeyId) {
    const [key] = await db
      .select({ groupId: externalApiKey.generationGroupId })
      .from(externalApiKey)
      .where(eq(externalApiKey.id, options.apiKeyId))
      .limit(1);
    if (key?.groupId) return { groupId: key.groupId, explicit: true };
  }

  const [preference] = await db
    .select({ groupId: userImageBackendPreference.groupId })
    .from(userImageBackendPreference)
    .where(eq(userImageBackendPreference.userId, options.userId))
    .limit(1);

  if (preference?.groupId) {
    return { groupId: preference.groupId, explicit: true };
  }

  return { groupId: await getDefaultGroupId(), explicit: false };
}

async function ensureGroupUsable(
  groupId: string | null,
  plan: SubscriptionPlan
) {
  if (!groupId) return null;
  const [group] = await db
    .select()
    .from(imageBackendGroup)
    .where(
      and(
        eq(imageBackendGroup.id, groupId),
        eq(imageBackendGroup.isEnabled, true)
      )
    )
    .limit(1);
  if (group && !canUseBackendGroupForPlan(group.metadata, plan)) {
    return null;
  }
  return group ?? null;
}

async function listSelectableGroupContexts(
  group: {
    id: string;
    metadata: Record<string, unknown> | null;
    contentSafetyEnabled: boolean | null;
  },
  plan: SubscriptionPlan,
  requestKind: ImageBackendRequestKind
): Promise<SelectableGroupContext[]> {
  const contexts: SelectableGroupContext[] = [
    {
      id: group.id,
      metadata: group.metadata,
      contentSafetyEnabled: group.contentSafetyEnabled,
    },
  ];
  if (getGroupBackendType(group.metadata) !== "mixed") return contexts;

  const childGroupIds = getGroupChildGroupIds(group.metadata).filter(
    (childGroupId) => childGroupId !== group.id
  );
  if (!childGroupIds.length) return contexts;

  const childGroups = await db
    .select({
      id: imageBackendGroup.id,
      metadata: imageBackendGroup.metadata,
      contentSafetyEnabled: imageBackendGroup.contentSafetyEnabled,
    })
    .from(imageBackendGroup)
    .where(
      and(
        inArray(imageBackendGroup.id, childGroupIds),
        eq(imageBackendGroup.isEnabled, true)
      )
    );
  const childGroupMap = new Map(childGroups.map((child) => [child.id, child]));

  for (const childGroupId of childGroupIds) {
    const child = childGroupMap.get(childGroupId);
    if (!child) continue;
    if (!canUseBackendGroupForPlan(child.metadata, plan)) continue;
    if (getGroupBackendType(child.metadata) === "mixed") continue;
    if (getGroupChildGroupIds(child.metadata).length) continue;
    if (!groupBackendAllowsRequest(child.metadata, requestKind)) continue;
    contexts.push({
      id: child.id,
      metadata: child.metadata,
      contentSafetyEnabled: child.contentSafetyEnabled,
    });
  }

  return contexts;
}

async function selectPoolMember(
  groupId: string | null,
  groupMetadata?: Record<string, unknown> | null,
  groupContentSafetyEnabled?: boolean | null,
  groupContexts?: SelectableGroupContext[],
  requestKind?: ImageBackendRequestKind,
  excluded?: Set<string>,
  preferredMemberId?: string,
  accountBackendPreference?: ImageBackendAccountBackend,
  accountBackendPreferenceMode?: ImageBackendPreferenceMode
): Promise<PoolMember | null> {
  const contexts =
    groupContexts && groupContexts.length
      ? groupContexts
      : groupId
        ? [
            {
              id: groupId,
              metadata: groupMetadata ?? null,
              contentSafetyEnabled: groupContentSafetyEnabled ?? null,
            },
          ]
        : [];
  const contextMap = new Map(contexts.map((context) => [context.id, context]));
  const groupIds = contexts.map((context) => context.id);
  const effectiveContextPreferences = new Map(
    contexts.map((context) => [
      context.id,
      resolveEffectiveAccountBackendPreference(
        context.metadata,
        accountBackendPreference,
        accountBackendPreferenceMode
      ),
    ])
  );
  const primaryContext = groupId ? contextMap.get(groupId) : undefined;
  const effectiveAccountBackendPreference = groupId
    ? resolveEffectiveAccountBackendPreference(
        primaryContext?.metadata ?? groupMetadata ?? null,
        accountBackendPreference,
        accountBackendPreferenceMode
      )
    : accountBackendPreferenceMode === "mixed-only"
      ? undefined
      : accountBackendPreference;
  const apiGroupFilter = groupIds.length
    ? inArray(imageBackendApi.groupId, groupIds)
    : groupId
      ? eq(imageBackendApi.groupId, groupId)
      : sql`true`;
  const requiredAccountBackend =
    requestKind === "responses"
      ? "responses"
      : effectiveAccountBackendPreference;
  const accountBackendFilter = requiredAccountBackend
    ? eq(imageBackendAccount.implementationMode, requiredAccountBackend)
    : sql`true`;
  const now = new Date();
  const accountBaseWhere = and(
    eq(imageBackendAccount.isEnabled, true),
    accountBackendFilter,
    isBackendAvailableStatus(
      imageBackendAccount.status,
      imageBackendAccount.cooldownUntil,
      now
    ),
    or(
      sql`${imageBackendAccount.cooldownUntil} IS NULL`,
      sql`${imageBackendAccount.cooldownUntil} <= ${now}`
    )
  );
  const accountRowsPromise = groupIds.length
    ? db
        .select({
          matchedGroupId: imageBackendAccountGroup.groupId,
          id: imageBackendAccount.id,
          groupId: imageBackendAccount.groupId,
          name: imageBackendAccount.name,
          accessToken: imageBackendAccount.accessToken,
          model: imageBackendAccount.model,
          implementationMode: imageBackendAccount.implementationMode,
          contentSafetyEnabled: imageBackendAccount.contentSafetyEnabled,
          priority: imageBackendAccount.priority,
          concurrency: imageBackendAccount.concurrency,
          lastUsedAt: imageBackendAccount.lastUsedAt,
          createdAt: imageBackendAccount.createdAt,
          metadata: imageBackendAccount.metadata,
        })
        .from(imageBackendAccount)
        .innerJoin(
          imageBackendAccountGroup,
          eq(imageBackendAccountGroup.accountId, imageBackendAccount.id)
        )
        .where(
          and(
            accountBaseWhere,
            inArray(imageBackendAccountGroup.groupId, groupIds)
          )
        )
        .orderBy(
          asc(imageBackendAccount.priority),
          asc(imageBackendAccount.lastUsedAt),
          asc(imageBackendAccount.createdAt)
        )
    : db
        .select({
          matchedGroupId: imageBackendAccount.groupId,
          id: imageBackendAccount.id,
          groupId: imageBackendAccount.groupId,
          name: imageBackendAccount.name,
          accessToken: imageBackendAccount.accessToken,
          model: imageBackendAccount.model,
          implementationMode: imageBackendAccount.implementationMode,
          contentSafetyEnabled: imageBackendAccount.contentSafetyEnabled,
          priority: imageBackendAccount.priority,
          concurrency: imageBackendAccount.concurrency,
          lastUsedAt: imageBackendAccount.lastUsedAt,
          createdAt: imageBackendAccount.createdAt,
          metadata: imageBackendAccount.metadata,
        })
        .from(imageBackendAccount)
        .where(
          and(
            accountBaseWhere,
            groupId ? eq(imageBackendAccount.groupId, groupId) : sql`true`
          )
        )
        .orderBy(
          asc(imageBackendAccount.priority),
          asc(imageBackendAccount.lastUsedAt),
          asc(imageBackendAccount.createdAt)
        );

  const [apiRows, accountRows] = await Promise.all([
    db
      .select()
      .from(imageBackendApi)
      .where(
        and(
          eq(imageBackendApi.isEnabled, true),
          apiGroupFilter,
          isBackendAvailableStatus(
            imageBackendApi.status,
            imageBackendApi.cooldownUntil,
            now
          ),
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
      ),
    accountRowsPromise,
  ]);

  const apiMembers: PoolMember[] =
    effectiveAccountBackendPreference === "web"
      ? []
      : apiRows
          .filter((row) => {
            const context = row.groupId ? contextMap.get(row.groupId) : null;
            const metadata = context?.metadata ?? groupMetadata;
            const effectiveRequestKind = requestKind || "image_generation";
            const requiresResponsesEndpoint =
              effectiveAccountBackendPreference === "responses";
            return (
              groupBackendAllowsRequest(metadata, effectiveRequestKind) &&
              imageBackendApiInterfaceAllowsRequest(
                row.interfaceMode,
                effectiveRequestKind
              ) &&
              (!requiresResponsesEndpoint ||
                imageBackendApiUsesResponsesEndpoint(
                  row.interfaceMode,
                  effectiveRequestKind,
                  true
                ))
            );
          })
          .map((row) => {
            const context = row.groupId ? contextMap.get(row.groupId) : null;
            return {
              type: "api",
              id: row.id,
              groupId: row.groupId,
              groupMetadata: context?.metadata ?? groupMetadata ?? null,
              groupContentSafetyEnabled:
                context?.contentSafetyEnabled ??
                groupContentSafetyEnabled ??
                null,
              name: row.name,
              baseUrl: row.baseUrl,
              apiKey: row.apiKey,
              model: row.model,
              interfaceMode: normalizeImageBackendApiInterfaceMode(
                row.interfaceMode
              ),
              useStream: row.useStream,
              contentSafetyEnabled: row.contentSafetyEnabled,
              priority: row.priority,
              concurrency: 1,
              lastUsedAt: row.lastUsedAt,
              createdAt: row.createdAt,
            };
          });

  const accountMembers: PoolMember[] = accountRows
    .filter((row) => {
      const backend = normalizeAccountBackend(row.implementationMode);
      const matchedGroupId = row.matchedGroupId || row.groupId;
      const context = matchedGroupId ? contextMap.get(matchedGroupId) : null;
      const metadata = context?.metadata ?? groupMetadata;
      const rowPreference = matchedGroupId
        ? effectiveContextPreferences.get(matchedGroupId)
        : effectiveAccountBackendPreference;
      return (
        (!rowPreference || rowPreference === backend) &&
        groupBackendAllowsAccount(metadata, backend) &&
        accountBackendAllowsRequest(
          backend,
          requestKind || "image_generation"
        ) &&
        isWebAccountQuotaAvailable(backend, row.metadata, now)
      );
    })
    .map((row) => ({
      type: "account",
      id: row.id,
      groupId: row.matchedGroupId || row.groupId,
      groupIds: normalizeAccountGroupIds([row.groupId, row.matchedGroupId]),
      groupMetadata:
        (row.matchedGroupId
          ? contextMap.get(row.matchedGroupId)?.metadata
          : null) ??
        groupMetadata ??
        null,
      groupContentSafetyEnabled:
        (row.matchedGroupId
          ? contextMap.get(row.matchedGroupId)?.contentSafetyEnabled
          : null) ??
        groupContentSafetyEnabled ??
        null,
      name: row.name,
      accessToken: row.accessToken,
      model: row.model,
      implementationMode: row.implementationMode,
      contentSafetyEnabled: row.contentSafetyEnabled,
      priority: row.priority,
      concurrency: row.concurrency,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      metadata: row.metadata,
    }));

  const candidates = [...apiMembers, ...accountMembers]
    .filter((member) => !excluded?.has(backendKey(member)))
    .sort((left, right) => {
      const preferredDiff =
        (right.id === preferredMemberId ? 1 : 0) -
        (left.id === preferredMemberId ? 1 : 0);
      if (preferredDiff !== 0) return preferredDiff;
      const priorityDiff = left.priority - right.priority;
      if (priorityDiff !== 0) return priorityDiff;
      const loadDiff = backendLoadRate(left) - backendLoadRate(right);
      if (loadDiff !== 0) return loadDiff;
      const inflightDiff =
        backendInflightCount(left) - backendInflightCount(right);
      if (inflightDiff !== 0) return inflightDiff;
      const lastUsedDiff =
        memberTimestamp(left.lastUsedAt) - memberTimestamp(right.lastUsedAt);
      if (lastUsedDiff !== 0) return lastUsedDiff;
      return memberTimestamp(left.createdAt) - memberTimestamp(right.createdAt);
    });

  for (const member of candidates) {
    if (await ensurePoolMemberSourceHealth(member)) return member;
    excluded?.add(backendKey(member));
  }

  return null;
}

async function markSub2ApiSourceMissing(
  member: PoolMember,
  sourceAccountId: string
) {
  if (member.type !== "account") return;
  const now = new Date();
  const message = `Sub2API 来源账号 ${sourceAccountId} 不存在或已被删除`;
  await db
    .update(imageBackendAccount)
    .set({
      isEnabled: false,
      status: "error",
      cooldownUntil: null,
      failCount: sql`${imageBackendAccount.failCount} + 1`,
      lastError: message,
      lastErrorAt: now,
      updatedAt: now,
    })
    .where(eq(imageBackendAccount.id, member.id));
  logWarn("选中的 Sub2API 来源账号不存在，已禁用本地后端账号", {
    memberId: member.id,
    sourceAccountId,
  });
}

async function getSub2ApiCurrentAccountBySourceId(sourceAccountId: string) {
  if (!/^\d+$/.test(sourceAccountId)) return null;
  const connectionString = await getOptionalSub2ApiPostgresConnectionString();
  if (!connectionString) return null;
  const pool = createSub2ApiPool(connectionString);
  try {
    const result = await pool.query<Sub2ApiAccountRow>(
      `
        SELECT
          a.id,
          a.name,
          a.platform,
          a.type,
          a.status,
          a.schedulable,
          a.error_message,
          a.rate_limit_reset_at,
          a.overload_until,
          a.temp_unschedulable_until,
          a.temp_unschedulable_reason,
          a.session_window_status,
          a.session_window_end,
          a.credentials,
          a.priority,
          a.concurrency,
          to_jsonb(a) - 'credentials' AS row_data,
          COALESCE(
            ARRAY_AGG(g.name ORDER BY ag.priority, g.name)
              FILTER (WHERE g.name IS NOT NULL),
            ARRAY[]::text[]
          ) AS group_names
        FROM accounts a
        LEFT JOIN account_groups ag ON ag.account_id = a.id
        LEFT JOIN groups g ON g.id = ag.group_id AND g.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND a.id = $1::bigint
        GROUP BY a.id
        LIMIT 1
      `,
      [sourceAccountId]
    );
    return result.rows
      .map(mapSub2ApiAccountRow)
      .find((account): account is Sub2ApiTokenAccount => Boolean(account)) ??
      null;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function ensurePoolMemberSourceHealth(member: PoolMember) {
  if (member.type !== "account") return true;
  if (!isSub2ApiBackedMetadata(member.metadata)) return true;

  const metadata = asBackendMetadata(member.metadata);
  const sourceAccountId = metadataString(metadata, "sourceAccountId");
  if (!sourceAccountId) return true;

  let sourceAccount: Sub2ApiTokenAccount | null = null;
  try {
    sourceAccount = await getSub2ApiCurrentAccountBySourceId(sourceAccountId);
  } catch (error) {
    logWarn("Sub2API 来源账号实时状态检查失败，继续使用本地快照", {
      memberId: member.id,
      sourceAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }

  if (!sourceAccount) {
    await markSub2ApiSourceMissing(member, sourceAccountId);
    return false;
  }

  const mode = normalizeAccountBackend(member.implementationMode);
  const existing = await getExistingSub2ApiSyncedAccountState(
    sourceAccount.sourceId,
    mode
  );
  const healthUpdate = await resolveSyncedAccountHealth(
    sourceAccount,
    existing,
    { overwriteLocalUnavailableState: true }
  );
  const hasFutureCooldown =
    healthUpdate.cooldownUntil &&
    healthUpdate.cooldownUntil.getTime() > Date.now();
  const sourceUnavailable =
    healthUpdate.isEnabled === false ||
    healthUpdate.status !== "active" ||
    Boolean(hasFutureCooldown) ||
    Boolean(healthUpdate.lastError);

  if (!sourceUnavailable) return true;

  await applySub2ApiHealthToExistingAccount(
    member.id,
    sourceAccount,
    mode,
    metadataString(metadata, "tokenSource") || null,
    Boolean(metadata.mobileRtImport),
    healthUpdate,
    metadataString(metadata, "sub2apiSyncTaskId") || null
  );
  logWarn("选中的 Sub2API 来源账号已不可用，已同步本地状态并跳过调度", {
    memberId: member.id,
    sourceAccountId,
    status: healthUpdate.status,
    cooldownUntil: healthUpdate.cooldownUntil?.toISOString() || null,
    error: healthUpdate.lastError,
  });
  return false;
}

async function touchSelectedMember(member: PoolMember) {
  const now = new Date();
  if (member.type === "api") {
    await db
      .update(imageBackendApi)
      .set({
        status: "active",
        cooldownUntil: null,
        lastUsedAt: now,
        lastAcquiredAt: now,
        updatedAt: now,
      })
      .where(eq(imageBackendApi.id, member.id));
    return;
  }

  await db
    .update(imageBackendAccount)
    .set({
      status: "active",
      cooldownUntil: null,
      lastUsedAt: now,
      lastAcquiredAt: now,
      updatedAt: now,
    })
    .where(eq(imageBackendAccount.id, member.id));
}

function toResolvedPoolConfig(
  fallbackGroupId: string,
  member: PoolMember,
  options: ResolveBackendOptions,
  billingGroupMetadata?: Record<string, unknown> | null
): ResolvedImageBackendPoolConfig {
  const groupId = member.groupId || fallbackGroupId;
  const billingMultiplier = getEffectiveBillingMultiplierForSelectedGroup({
    selectedGroupId: fallbackGroupId,
    selectedGroupMetadata: billingGroupMetadata,
    selectedMemberGroupId: member.groupId,
    selectedMemberGroupMetadata: member.groupMetadata,
  });
  const contentSafetyEnabled = effectiveContentSafety(
    member.groupContentSafetyEnabled,
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
          userId: options.userId,
          apiKeyId: options.apiKeyId,
          requestKind: options.requestKind,
          apiInterfaceMode: member.interfaceMode,
          apiForceResponsesEndpoint:
            options.accountBackendPreference === "responses",
          billingGroupId: fallbackGroupId,
          billingMultiplier,
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
  const chatgptAccountId = metadataString(member.metadata, "chatgptAccountId");

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
            Version: CODEX_CLI_VERSION,
            "User-Agent": CODEX_CLI_USER_AGENT,
            ...(chatgptAccountId
              ? { "chatgpt-account-id": chatgptAccountId }
              : {}),
          }
        : undefined,
      backend: {
        type: "pool-account",
        id: member.id,
        groupId,
        userId: options.userId,
        apiKeyId: options.apiKeyId,
        requestKind: options.requestKind,
        accountBackend: implementationMode,
        billingGroupId: fallbackGroupId,
        billingMultiplier,
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
  const userPlan = await getUserPlan(options.userId);
  const requestedGroup = await resolveRequestedGroup(options);
  const requestedGroupId = requestedGroup.groupId;
  const group = await ensureGroupUsable(requestedGroupId, userPlan.plan);
  if (!group) {
    if (requestedGroup.explicit) {
      throw new ImageBackendPoolUnavailableError(
        "选择的生图后端分组不可用或当前套餐不可用"
      );
    }
    return null;
  }

  if (!groupBackendAllowsRequest(group.metadata, options.requestKind)) {
    if (requestedGroup.explicit) {
      throw new ImageBackendPoolUnavailableError(
        `生图后端分组「${group.name}」不支持当前请求类型`
      );
    }
    return null;
  }

  const member = await selectPoolMember(
    group.id,
    group.metadata,
    group.contentSafetyEnabled,
    await listSelectableGroupContexts(
      group,
      userPlan.plan,
      options.requestKind
    ),
    options.requestKind,
    options.excluded,
    options.preferredMemberId,
    options.accountBackendPreference,
    options.accountBackendPreferenceMode
  );
  if (!member) {
    if (requestedGroup.explicit) {
      throw new ImageBackendPoolUnavailableError(
        `生图后端分组「${group.name}」没有可用账号或 API`
      );
    }
    return null;
  }

  return { group, member };
}

export async function resolveImageBackendPoolConfig(
  options: ResolveBackendOptions & { excludedMemberKeys?: string[] }
): Promise<ResolvedImageBackendPoolConfig | null> {
  const resolved = await resolvePoolMember({
    ...options,
    excluded: new Set(options.excludedMemberKeys || []),
  });
  if (!resolved) return null;
  await touchSelectedMember(resolved.member);
  const result = toResolvedPoolConfig(
    resolved.group.id,
    resolved.member,
    options,
    resolved.group.metadata
  );
  return result;
}

export async function reportImageBackendResult(
  input: ImageBackendReportResultInput
): Promise<ImageBackendReportResultOutcome> {
  if (!input.memberId || !input.memberType) {
    return { success: input.success, retryable: false, switchable: false };
  }
  const now = new Date();
  const error = truncateError(input.error);
  const failure = input.success ? {} : await classifyFailure(error, input);
  const outcome = {
    success: input.success,
    status: failure.status,
    cooldownUntil: failure.cooldownUntil,
    retryable: !input.success && isClassifiedFailureRecoverable(error, failure),
    switchable: !input.success && isImageBackendSwitchableError(error),
  };

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
    if (!input.success) {
      logWarn("生图 API 后端失败，已更新调度状态", {
        memberType: input.memberType,
        memberId: input.memberId,
        status: failure.status || "unchanged",
        cooldownUntil: failure.cooldownUntil
          ? failure.cooldownUntil.toISOString()
          : null,
        retryable: outcome.retryable,
        switchable: outcome.switchable,
        error,
      });
    }
    return outcome;
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
  if (!input.success) {
    logWarn("生图账号后端失败，已更新调度状态", {
      memberType: input.memberType,
      memberId: input.memberId,
      backend,
      status: failure.status || "unchanged",
      cooldownUntil: failure.cooldownUntil
        ? failure.cooldownUntil.toISOString()
        : null,
      retryable: outcome.retryable,
      switchable: outcome.switchable,
      error,
    });
  }
  return outcome;
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
    const failure = await classifyFailure(message);
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

export async function refreshImageBackendAccountsInfo(accountIds: string[]) {
  const ids = Array.from(
    new Set(accountIds.map((id) => id.trim()).filter(Boolean))
  );
  if (!ids.length) throw new Error("请选择账号");

  const rows = await db
    .select({
      id: imageBackendAccount.id,
      implementationMode: imageBackendAccount.implementationMode,
    })
    .from(imageBackendAccount)
    .where(inArray(imageBackendAccount.id, ids));

  const knownIds = new Set(rows.map((row) => row.id));
  const webIds = rows
    .filter((row) => normalizeAccountBackend(row.implementationMode) === "web")
    .map((row) => row.id);
  const skippedCount =
    ids.filter((id) => !knownIds.has(id)).length +
    (rows.length - webIds.length);

  let refreshedCount = 0;
  let failedCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  const results: Array<{
    id: string;
    success: boolean;
    quota?: number;
    imageQuotaUnknown?: boolean;
    error?: string;
  }> = [];

  const maxWorkers = Math.min(10, Math.max(1, webIds.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: maxWorkers }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const id = webIds[index];
        if (!id) break;
        try {
          const info = await refreshImageBackendAccountInfo(id);
          refreshedCount++;
          results.push({
            id,
            success: true,
            quota: info.quota,
            imageQuotaUnknown: info.imageQuotaUnknown,
          });
        } catch (error) {
          failedCount++;
          const message =
            error instanceof Error ? error.message : "刷新账号远端信息失败";
          errors.push({ id, error: message });
          results.push({
            id,
            success: false,
            error: message,
          });
        }
      }
    })
  );

  return {
    requestedCount: ids.length,
    processedCount: webIds.length,
    refreshedCount,
    failedCount,
    skippedCount,
    errors,
    results,
  };
}

export async function listImageBackendGroupOptions(options?: {
  userSelectableOnly?: boolean;
  plan?: SubscriptionPlan;
}) {
  const plan = options?.plan;
  const rows = await db
    .select({
      id: imageBackendGroup.id,
      name: imageBackendGroup.name,
      description: imageBackendGroup.description,
      isDefault: imageBackendGroup.isDefault,
      isUserSelectable: imageBackendGroup.isUserSelectable,
      isEnabled: imageBackendGroup.isEnabled,
      contentSafetyEnabled: imageBackendGroup.contentSafetyEnabled,
      priority: imageBackendGroup.priority,
      metadata: imageBackendGroup.metadata,
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
  return rows
    .filter((group) =>
      plan ? canUseBackendGroupForPlan(group.metadata, plan) : true
    )
    .map(({ metadata, ...group }) => ({
      ...group,
      minPlan: getGroupMinPlan(metadata),
      backendType: getGroupBackendType(metadata),
      billingMultiplier: getGroupBillingMultiplier(metadata),
      childGroupIds: getGroupChildGroupIds(metadata),
    }));
}

export async function listSelectableImageBackendGroups(
  plan?: SubscriptionPlan
) {
  if (plan && !(await canUsePlanCapability(plan, "backendGroups.select"))) {
    return [];
  }
  return await listImageBackendGroupOptions({ userSelectableOnly: true, plan });
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
  groupId: string | null,
  plan: SubscriptionPlan
) {
  if (groupId && !(await canUsePlanCapability(plan, "backendGroups.select"))) {
    throw new Error("当前套餐不可手动选择生图分组");
  }
  if (groupId) {
    const [group] = await db
      .select({
        id: imageBackendGroup.id,
        metadata: imageBackendGroup.metadata,
      })
      .from(imageBackendGroup)
      .where(
        and(
          eq(imageBackendGroup.id, groupId),
          eq(imageBackendGroup.isEnabled, true),
          eq(imageBackendGroup.isUserSelectable, true)
        )
      )
      .limit(1);
    if (!group || !canUseBackendGroupForPlan(group.metadata, plan)) {
      throw new Error("生图分组不存在、不可选择或当前套餐不可用");
    }
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
  backendType: ImageBackendGroupBackendType;
  minPlan: SubscriptionPlan;
  billingMultiplier: number;
  childGroupIds?: string[];
  priority: number;
};

async function normalizeUpsertGroupChildGroupIds(input: UpsertGroupInput) {
  const groups = await db
    .select({
      id: imageBackendGroup.id,
      name: imageBackendGroup.name,
      metadata: imageBackendGroup.metadata,
    })
    .from(imageBackendGroup)
    .orderBy(asc(imageBackendGroup.createdAt));
  const result = validateNestedGroupConfig({
    groupId: input.id,
    backendType: input.backendType,
    childGroupIds: input.childGroupIds,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      backendType: getGroupBackendType(group.metadata),
      childGroupIds: getGroupChildGroupIds(group.metadata),
    })),
  });
  if (!result.ok) throw new Error(result.error);

  return result.childGroupIds;
}

export async function upsertImageBackendGroup(input: UpsertGroupInput) {
  const childGroupIds = await normalizeUpsertGroupChildGroupIds(input);

  if (input.isDefault) {
    await db.update(imageBackendGroup).set({
      isDefault: false,
      updatedAt: new Date(),
    });
  }

  if (input.id) {
    const [existing] = await db
      .select({ metadata: imageBackendGroup.metadata })
      .from(imageBackendGroup)
      .where(eq(imageBackendGroup.id, input.id))
      .limit(1);
    const metadata = {
      ...asGroupMetadata(existing?.metadata),
      minPlan: input.minPlan,
      backendType: input.backendType,
      billingMultiplier: input.billingMultiplier,
      childGroupIds,
    };
    await db
      .update(imageBackendGroup)
      .set({
        name: input.name,
        description: input.description || null,
        isEnabled: input.isEnabled,
        isDefault: input.isDefault,
        isUserSelectable: input.isUserSelectable,
        contentSafetyEnabled: input.contentSafetyEnabled,
        metadata,
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
    metadata: {
      minPlan: input.minPlan,
      backendType: input.backendType,
      billingMultiplier: input.billingMultiplier,
      childGroupIds,
    },
    priority: input.priority,
  });
  return id;
}

export async function deleteImageBackendGroup(groupId: string) {
  await db.delete(imageBackendGroup).where(eq(imageBackendGroup.id, groupId));
}

type UpsertAccountInput = {
  id?: string;
  groupId?: string | null;
  groupIds?: string[] | null;
  mergeGroupIds?: boolean;
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
  cooldownUntil?: Date | null;
  lastError?: string | null;
  lastErrorAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};

async function setImageBackendAccountGroups(input: {
  accountId: string;
  groupIds: string[];
  replace: boolean;
}) {
  const groupIds = normalizeAccountGroupIds(input.groupIds);
  if (input.replace) {
    await db
      .delete(imageBackendAccountGroup)
      .where(eq(imageBackendAccountGroup.accountId, input.accountId));
  }
  if (!groupIds.length) return;

  await db
    .insert(imageBackendAccountGroup)
    .values(
      groupIds.map((groupId) => ({
        id: `${input.accountId}:${groupId}`,
        accountId: input.accountId,
        groupId,
      }))
    )
    .onConflictDoNothing();
}

function clientIdForAccountBackend(backend: ImageBackendAccountBackend) {
  return backend === "responses"
    ? OPENAI_CODEX_OAUTH_CLIENT_ID
    : OPENAI_PLATFORM_OAUTH_CLIENT_ID;
}

function tokenSourceForRefreshClient(
  clientId: string,
  backend: ImageBackendAccountBackend
) {
  if (clientId === OPENAI_MOBILE_RT_CLIENT_ID) {
    return "openai.oauth.mobile_refresh";
  }
  return backend === "responses"
    ? "openai.oauth.codex_refresh"
    : "openai.oauth.platform_refresh";
}

async function refreshAccessTokenForBackend(
  refreshToken: string,
  backend: ImageBackendAccountBackend,
  clientId = clientIdForAccountBackend(backend)
) {
  return await refreshOpenAIAccessToken(refreshToken, clientId);
}

export async function upsertImageBackendAccount(input: UpsertAccountInput) {
  const implementationMode = normalizeAccountBackend(input.implementationMode);
  const groupIds = accountGroupIdsFromInput(input);
  const primaryGroupId = groupIds[0] || null;
  let accessToken = input.accessToken?.trim() || "";
  let refreshToken =
    input.refreshToken === undefined
      ? undefined
      : input.refreshToken?.trim() || null;
  let existingPrimaryGroupId: string | null | undefined;

  if (input.id) {
    const [existingAccount] = await db
      .select({
        groupId: imageBackendAccount.groupId,
        metadata: imageBackendAccount.metadata,
      })
      .from(imageBackendAccount)
      .where(eq(imageBackendAccount.id, input.id))
      .limit(1);
    existingPrimaryGroupId = existingAccount?.groupId ?? null;
    if (
      refreshToken !== undefined &&
      isSub2ApiBackedMetadata(existingAccount?.metadata)
    ) {
      throw new Error("Sub2API 同步账号的 RT 由 Sub2API 管理，不能在这里修改");
    }
  }

  if (!accessToken && refreshToken) {
    const refreshed = await refreshAccessTokenForBackend(
      refreshToken,
      implementationMode
    );
    if (!refreshed?.accessToken) {
      throw new Error("Refresh Token 无法换取 Access Token");
    }
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken || refreshToken;
  }

  const updateBase = {
    name: input.name,
    email: input.email || null,
    implementationMode,
    model: input.model || null,
    contentSafetyEnabled: input.contentSafetyEnabled,
    isEnabled: input.isEnabled,
    priority: input.priority,
    concurrency: input.concurrency,
    status: input.status || "active",
    ...(input.cooldownUntil !== undefined
      ? { cooldownUntil: input.cooldownUntil }
      : {}),
    ...(input.lastError !== undefined
      ? { lastError: truncateError(input.lastError) }
      : {}),
    ...(input.lastErrorAt !== undefined
      ? { lastErrorAt: input.lastErrorAt }
      : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
    updatedAt: new Date(),
  };

  if (input.id) {
    const update = {
      ...updateBase,
      groupId: input.mergeGroupIds
        ? existingPrimaryGroupId || primaryGroupId
        : primaryGroupId,
    };
    await db
      .update(imageBackendAccount)
      .set(
        accessToken
          ? {
              ...update,
              accessToken,
              credentialHash: hashBackendCredential(accessToken),
            }
          : update
      )
      .where(eq(imageBackendAccount.id, input.id));
    await setImageBackendAccountGroups({
      accountId: input.id,
      groupIds,
      replace: !input.mergeGroupIds,
    });
    return input.id;
  }

  if (!accessToken) {
    throw new Error("accessToken is required");
  }

  const credentialHash = hashBackendCredential(accessToken);
  const [existing] = await db
    .select({
      id: imageBackendAccount.id,
      groupId: imageBackendAccount.groupId,
    })
    .from(imageBackendAccount)
    .where(
      and(
        eq(imageBackendAccount.credentialHash, credentialHash),
        eq(imageBackendAccount.implementationMode, implementationMode)
      )
    )
    .limit(1);
  if (existing) {
    const update = {
      ...updateBase,
      groupId: input.mergeGroupIds
        ? existing.groupId || primaryGroupId
        : primaryGroupId,
    };
    await db
      .update(imageBackendAccount)
      .set({
        ...update,
        accessToken,
        credentialHash,
      })
      .where(eq(imageBackendAccount.id, existing.id));
    await setImageBackendAccountGroups({
      accountId: existing.id,
      groupIds,
      replace: !input.mergeGroupIds,
    });
    return existing.id;
  }

  const id = nanoid();
  const update = {
    ...updateBase,
    groupId: primaryGroupId,
  };
  await db.insert(imageBackendAccount).values({
    id,
    ...update,
    refreshToken: refreshToken || null,
    accessToken,
    credentialHash,
  });
  await setImageBackendAccountGroups({
    accountId: id,
    groupIds,
    replace: true,
  });
  return id;
}

type BulkUpdateAccountsInput = {
  accountIds: string[];
  groupId?: string | null;
  implementationMode?: ImageBackendAccountBackend | null;
  contentSafetyEnabled?: boolean | null;
  isEnabled?: boolean | null;
  status?: string | null;
  resetAvailability?: boolean | null;
  priority?: number | null;
  concurrency?: number | null;
};

export async function bulkUpdateImageBackendAccounts(
  input: BulkUpdateAccountsInput
) {
  const accountIds = Array.from(new Set(input.accountIds.filter(Boolean)));
  if (!accountIds.length) throw new Error("请选择账号");

  const baseUpdate: Partial<typeof imageBackendAccount.$inferInsert> = {
    updatedAt: new Date(),
  };
  const targetMode = input.implementationMode
    ? normalizeAccountBackend(input.implementationMode)
    : null;
  const bulkGroupIds =
    input.groupId !== undefined
      ? normalizeAccountGroupIds(input.groupId ? [input.groupId] : [])
      : null;
  if (
    input.contentSafetyEnabled !== undefined &&
    input.contentSafetyEnabled !== null
  ) {
    baseUpdate.contentSafetyEnabled = input.contentSafetyEnabled;
  }
  if (input.isEnabled !== undefined && input.isEnabled !== null) {
    baseUpdate.isEnabled = input.isEnabled;
  }
  if (input.status !== undefined && input.status !== null) {
    baseUpdate.status = input.status || "active";
  }
  if (input.priority !== undefined && input.priority !== null) {
    baseUpdate.priority = Math.max(0, Math.min(10000, input.priority));
  }
  if (input.concurrency !== undefined && input.concurrency !== null) {
    baseUpdate.concurrency = Math.max(1, Math.min(100, input.concurrency));
  }
  if (input.resetAvailability) {
    baseUpdate.status = "active";
    baseUpdate.isEnabled = true;
    baseUpdate.cooldownUntil = null;
    baseUpdate.lastError = null;
    baseUpdate.lastErrorAt = null;
  }

  if (
    Object.keys(baseUpdate).length <= 1 &&
    !targetMode &&
    bulkGroupIds === null
  ) {
    throw new Error("请选择要批量修改的内容");
  }

  let updatedCount = 0;
  let failedCount = 0;
  for (const accountId of accountIds) {
    try {
      const update = { ...baseUpdate };
      if (bulkGroupIds) {
        update.groupId = bulkGroupIds[0] || null;
      }
      if (targetMode) {
        const [account] = await db
          .select({
            implementationMode: imageBackendAccount.implementationMode,
            refreshToken: imageBackendAccount.refreshToken,
            metadata: imageBackendAccount.metadata,
          })
          .from(imageBackendAccount)
          .where(eq(imageBackendAccount.id, accountId))
          .limit(1);
        if (!account) throw new Error("账号不存在");
        if (
          normalizeAccountBackend(account.implementationMode) !== targetMode
        ) {
          if (isSub2ApiBackedMetadata(account.metadata)) {
            throw new Error("Sub2API 同步账号不能在本站切换接口模式");
          }
          if (!account.refreshToken) {
            throw new Error("账号没有保存 RT，无法刷新目标接口模式的 AT");
          }
          const refreshed = await refreshAccessTokenForBackend(
            account.refreshToken,
            targetMode
          );
          if (!refreshed?.accessToken) {
            throw new Error("Refresh Token 无法换取目标模式 Access Token");
          }
          update.implementationMode = targetMode;
          update.accessToken = refreshed.accessToken;
          update.credentialHash = hashBackendCredential(refreshed.accessToken);
          update.refreshToken = refreshed.refreshToken || account.refreshToken;
        }
      }
      await db
        .update(imageBackendAccount)
        .set(update)
        .where(eq(imageBackendAccount.id, accountId));
      if (bulkGroupIds) {
        await setImageBackendAccountGroups({
          accountId,
          groupIds: bulkGroupIds,
          replace: true,
        });
      }
      updatedCount++;
    } catch (error) {
      failedCount++;
      logWarn("批量更新生图账号失败，已跳过", {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { updatedCount, failedCount };
}

async function importAccessTokens(
  input: {
    accessTokens: string[];
    webGroupId?: string | null;
    namePrefix?: string | null;
    model?: string | null;
    contentSafetyEnabled: boolean;
    priority: number;
    concurrency: number;
  },
  counters: {
    syncedByMode: Record<ImageBackendAccountBackend, number>;
    failedByMode: Record<ImageBackendAccountBackend, number>;
    importedIds: string[];
  },
  importBatchId: string
) {
  for (const [index, accessToken] of input.accessTokens.entries()) {
    try {
      const id = await upsertImageBackendAccount({
        groupId: input.webGroupId,
        mergeGroupIds: true,
        name: `${input.namePrefix?.trim() || "Auth Session 导入"} ${
          index + 1
        } / Web`,
        email: null,
        accessToken,
        refreshToken: null,
        implementationMode: "web",
        model: input.model || null,
        contentSafetyEnabled: input.contentSafetyEnabled,
        isEnabled: true,
        priority: input.priority,
        concurrency: Math.max(1, Math.min(100, input.concurrency)),
        status: "active",
        metadata: {
          source: "manual_web_access_token",
          importBatchId,
          importIndex: index + 1,
          syncedAt: new Date().toISOString(),
          tokenSource: "chatgpt.web_access_token",
        },
      });
      counters.importedIds.push(id);
      counters.syncedByMode.web++;
    } catch (error) {
      counters.failedByMode.web++;
      logWarn("手工 Web AT 导入生图账号失败，已跳过", {
        index: index + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function emptyRefreshTokenImportResult(message: string) {
  return {
    sourceCount: 0,
    syncedCount: 0,
    syncedByMode: { web: 0, responses: 0 },
    skipped: { web: 0, responses: 0 },
    failed: 0,
    failedByMode: { web: 0, responses: 0 },
    refreshTokenRotatedCount: 0,
    message,
  };
}

function emptyAccessTokenImportResult(message: string) {
  return {
    sourceCount: 0,
    syncedCount: 0,
    syncedByMode: { web: 0, responses: 0 },
    skipped: { web: 0, responses: 0 },
    failed: 0,
    failedByMode: { web: 0, responses: 0 },
    message,
  };
}

export async function importImageBackendWebAccountsFromAccessTokens(input: {
  accessTokensText: string;
  webGroupId?: string | null;
  namePrefix?: string | null;
  model?: string | null;
  contentSafetyEnabled: boolean;
  priority: number;
  concurrency: number;
}) {
  const parsedTokens = parseImportTokensText(input.accessTokensText, {
    plainFallback: "access",
  });
  const parsedAccessTokenCount = parsedTokens.accessTokens.length;
  const accessTokens = parsedTokens.accessTokens.slice(
    0,
    MANUAL_TOKEN_IMPORT_LIMIT
  );
  const syncedByMode: Record<ImageBackendAccountBackend, number> = {
    web: 0,
    responses: 0,
  };
  const failedByMode: Record<ImageBackendAccountBackend, number> = {
    web: 0,
    responses: 0,
  };
  const skipped: Record<ImageBackendAccountBackend, number> = {
    web: 0,
    responses: 0,
  };
  const importedIds: string[] = [];
  const importBatchId = nanoid();

  if (!accessTokens.length) {
    return emptyAccessTokenImportResult(
      "未提取到可导入的 Web AT。请粘贴 accessToken、Bearer token，或粘贴 Auth Session 完整 JSON。"
    );
  }

  await importAccessTokens(
    {
      accessTokens,
      webGroupId: input.webGroupId,
      namePrefix: input.namePrefix,
      model: input.model,
      contentSafetyEnabled: input.contentSafetyEnabled,
      priority: input.priority,
      concurrency: input.concurrency,
    },
    { syncedByMode, failedByMode, importedIds },
    importBatchId
  );

  return {
    sourceCount: parsedAccessTokenCount,
    syncedCount: importedIds.length,
    syncedByMode,
    skipped,
    failed: failedByMode.web + failedByMode.responses,
    failedByMode,
    message:
      parsedAccessTokenCount > accessTokens.length
        ? `已导入前 ${accessTokens.length} 个 Web AT，超出 ${MANUAL_TOKEN_IMPORT_LIMIT} 个的部分已跳过。该类账号没有 RT，AT 过期后需要重新导入。`
        : "已导入 Web AT。该类账号没有 RT，AT 过期后需要重新导入。",
  };
}

export async function importImageBackendAccountsFromRefreshTokens(input: {
  refreshTokensText: string;
  webGroupId?: string | null;
  responsesGroupId?: string | null;
  syncMode: Sub2ApiTokenSyncMode;
  useMobileRt?: boolean;
  namePrefix?: string | null;
  model?: string | null;
  contentSafetyEnabled: boolean;
  priority: number;
  concurrency: number;
  importBatchId?: string | null;
  startIndex?: number;
}) {
  const parsedTokens = parseImportTokensText(input.refreshTokensText, {
    plainFallback: "refresh",
  });
  const parsedRefreshTokenCount = parsedTokens.refreshTokens.length;
  const refreshTokens = parsedTokens.refreshTokens.slice(
    0,
    MANUAL_TOKEN_IMPORT_LIMIT
  );

  const effectiveSyncMode = input.useMobileRt ? input.syncMode : "responses";
  const modes =
    effectiveSyncMode === "both"
      ? (["web", "responses"] as const)
      : ([effectiveSyncMode] as const);
  const syncedByMode: Record<ImageBackendAccountBackend, number> = {
    web: 0,
    responses: 0,
  };
  const failedByMode: Record<ImageBackendAccountBackend, number> = {
    web: 0,
    responses: 0,
  };
  const skipped: Record<ImageBackendAccountBackend, number> = {
    web: 0,
    responses: 0,
  };
  let refreshTokenRotatedCount = 0;
  const importedIds: string[] = [];
  const importBatchId = input.importBatchId || nanoid();
  const startIndex = Math.max(0, Math.trunc(input.startIndex || 0));

  if (!refreshTokens.length) {
    return emptyRefreshTokenImportResult(
      "未提取到可导入的 RT。请粘贴 RT 列表，或粘贴包含 refresh_token/refreshToken 的 Auth Session；如果只有 accessToken，请使用“导入 Web AT”。"
    );
  }

  for (const [index, originalRefreshToken] of refreshTokens.entries()) {
    const importIndex = startIndex + index + 1;
    let currentRefreshToken = originalRefreshToken;
    const currentTokenImportedIds: string[] = [];
    if (input.useMobileRt) {
      try {
        const refreshed = await refreshOpenAIAccessToken(
          currentRefreshToken,
          OPENAI_MOBILE_RT_CLIENT_ID
        );
        if (!refreshed?.accessToken) {
          for (const mode of modes) skipped[mode]++;
          continue;
        }
        const nextRefreshToken = refreshed.refreshToken || currentRefreshToken;
        if (nextRefreshToken !== currentRefreshToken) {
          refreshTokenRotatedCount++;
          currentRefreshToken = nextRefreshToken;
        }

        for (const mode of modes) {
          const id = await upsertImageBackendAccount({
            groupId:
              mode === "responses" ? input.responsesGroupId : input.webGroupId,
            mergeGroupIds: true,
            name: `${
              input.namePrefix?.trim() || "Mobile RT 导入"
            } ${importIndex} / ${mode === "responses" ? "Codex" : "Web"}`,
            email: null,
            accessToken: refreshed.accessToken,
            refreshToken: currentRefreshToken,
            implementationMode: mode,
            model: input.model || null,
            contentSafetyEnabled: input.contentSafetyEnabled,
            isEnabled: true,
            priority: input.priority,
            concurrency: Math.max(1, Math.min(100, input.concurrency)),
            status: "active",
            metadata: {
              source: "manual_refresh_token",
              importBatchId,
              importIndex,
              syncedAt: new Date().toISOString(),
              tokenSource: tokenSourceForRefreshClient(
                OPENAI_MOBILE_RT_CLIENT_ID,
                mode
              ),
              oauthClientId: OPENAI_MOBILE_RT_CLIENT_ID,
              mobileRtImport: true,
              refreshTokenRotated: nextRefreshToken !== originalRefreshToken,
            },
          });
          importedIds.push(id);
          currentTokenImportedIds.push(id);
          syncedByMode[mode]++;
        }

        if (currentTokenImportedIds.length) {
          await db
            .update(imageBackendAccount)
            .set({
              refreshToken: currentRefreshToken,
              updatedAt: new Date(),
            })
            .where(inArray(imageBackendAccount.id, currentTokenImportedIds));
        }
      } catch (error) {
        for (const mode of modes) failedByMode[mode]++;
        logWarn("手工 Mobile RT 导入生图账号失败，已跳过", {
          index: importIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    for (const mode of modes) {
      try {
        const clientId = clientIdForAccountBackend(mode);
        const refreshed = await refreshAccessTokenForBackend(
          currentRefreshToken,
          mode,
          clientId
        );
        if (!refreshed?.accessToken) {
          skipped[mode]++;
          continue;
        }
        const nextRefreshToken = refreshed.refreshToken || currentRefreshToken;
        if (nextRefreshToken !== currentRefreshToken) {
          refreshTokenRotatedCount++;
          currentRefreshToken = nextRefreshToken;
        }

        const id = await upsertImageBackendAccount({
          groupId:
            mode === "responses" ? input.responsesGroupId : input.webGroupId,
          mergeGroupIds: true,
          name: `${input.namePrefix?.trim() || "手工导入"} ${importIndex} / ${
            mode === "responses" ? "Codex" : "Web"
          }`,
          email: null,
          accessToken: refreshed.accessToken,
          refreshToken: currentRefreshToken,
          implementationMode: mode,
          model: input.model || null,
          contentSafetyEnabled: input.contentSafetyEnabled,
          isEnabled: true,
          priority: input.priority,
          concurrency: Math.max(1, Math.min(100, input.concurrency)),
          status: "active",
          metadata: {
            source: "manual_refresh_token",
            importBatchId,
            importIndex,
            syncedAt: new Date().toISOString(),
            tokenSource: tokenSourceForRefreshClient(clientId, mode),
            oauthClientId: clientId,
            mobileRtImport: false,
            refreshTokenRotated: nextRefreshToken !== originalRefreshToken,
          },
        });
        importedIds.push(id);
        currentTokenImportedIds.push(id);
        syncedByMode[mode]++;
      } catch (error) {
        failedByMode[mode]++;
        logWarn("手工 RT 导入生图账号失败，已跳过", {
          mode,
          index: importIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (currentTokenImportedIds.length) {
      await db
        .update(imageBackendAccount)
        .set({
          refreshToken: currentRefreshToken,
          updatedAt: new Date(),
        })
        .where(inArray(imageBackendAccount.id, currentTokenImportedIds));
    }
  }

  return {
    sourceCount: parsedRefreshTokenCount,
    syncedCount: importedIds.length,
    syncedByMode,
    skipped,
    failed: failedByMode.web + failedByMode.responses,
    failedByMode,
    refreshTokenRotatedCount,
    message:
      parsedRefreshTokenCount > refreshTokens.length
        ? `已导入前 ${refreshTokens.length} 个 RT，超出 ${MANUAL_TOKEN_IMPORT_LIMIT} 个的部分已跳过。`
        : (null as string | null),
  };
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
  error_message?: string | null;
  rate_limit_reset_at?: Date | string | null;
  overload_until?: Date | string | null;
  temp_unschedulable_until?: Date | string | null;
  temp_unschedulable_reason?: string | null;
  session_window_status?: string | null;
  session_window_end?: Date | string | null;
  credentials: Record<string, unknown> | null;
  priority: number | null;
  concurrency: number | null;
  group_names: string[] | null;
  row_data: Record<string, unknown> | null;
};

type Sub2ApiTokenAccount = {
  sourceId: string;
  name: string | null;
  email: string | null;
  chatgptAccountId: string | null;
  codexAccessToken: string | null;
  refreshToken: string | null;
  clientId: string | null;
  oauthFamily: string | null;
  oauthType: string | null;
  priority: number | null;
  concurrency: number | null;
  planType: string | null;
  groupNames: string[];
  sourceStatus: string | null;
  sourceSchedulable: boolean | null;
  sourceError: string | null;
  sourceStatusCode: string | null;
  sourceRateLimitResetAt: Date | null;
  sourceOverloadUntil: Date | null;
  sourceTempUnschedulableUntil: Date | null;
  sourceCooldownUntil: Date | null;
  sourceUpdatedAt: Date | null;
};

type Sub2ApiPlanFilter = "all" | "free" | "plus" | "pro" | "non_free";
type Sub2ApiAutoSyncTask = {
  id: string;
  enabled: boolean;
  sourceGroupId: string | null;
  sourceGroupName?: string | null;
  webGroupId?: string | null;
  responsesGroupId?: string | null;
  syncMode: Sub2ApiTokenSyncMode;
  allowMobileRtImport: boolean;
  contentSafetyEnabled: boolean;
  overwriteLocalUnavailableState: boolean;
  planFilter: Sub2ApiPlanFilter;
  createdAt?: string;
  updatedAt?: string;
  lastRunAt?: string;
  lastResult?: {
    sourceCount: number;
    totalSourceCount: number;
    syncedCount: number;
    skipped: { web: number; responses: number };
    failed: number;
    failedByMode: { web: number; responses: number };
    syncedByMode: { web: number; responses: number };
    deletedCount: number;
  };
};

export type Sub2ApiAutoSyncTaskSummary = Sub2ApiAutoSyncTask & {
  managedAccountCount: number;
};

type AutoSub2ApiSyncMetadata = {
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastSuccessAt?: string;
  lastSkippedAt?: string;
  lastErrorAt?: string;
  lastStatus?: "success" | "error" | "skipped";
  lastError?: string;
  lastResult?: {
    sourceCount: number;
    totalSourceCount: number;
    syncedCount: number;
    skipped: { web: number; responses: number };
    failed: number;
    failedByMode: { web: number; responses: number };
    syncedByMode: { web: number; responses: number };
    deletedCount?: number;
    tasks?: Array<{
      id: string;
      sourceGroupId: string | null;
      sourceGroupName?: string | null;
      sourceCount: number;
      totalSourceCount: number;
      syncedCount: number;
      failed: number;
      deletedCount: number;
    }>;
  };
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

function mergedSub2ApiData(
  row: Sub2ApiAccountRow,
  credentials: Record<string, unknown>
) {
  return {
    ...(row.row_data || {}),
    error_message: row.error_message ?? row.row_data?.error_message,
    rate_limit_reset_at:
      row.rate_limit_reset_at ?? row.row_data?.rate_limit_reset_at,
    overload_until: row.overload_until ?? row.row_data?.overload_until,
    temp_unschedulable_until:
      row.temp_unschedulable_until ??
      row.row_data?.temp_unschedulable_until,
    temp_unschedulable_reason:
      row.temp_unschedulable_reason ??
      row.row_data?.temp_unschedulable_reason,
    session_window_status:
      row.session_window_status ?? row.row_data?.session_window_status,
    session_window_end:
      row.session_window_end ?? row.row_data?.session_window_end,
    ...credentials,
  };
}

function credentialValue(
  credentials: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  for (const key of keys) {
    const value = credentials?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function credentialDate(
  credentials: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  for (const key of keys) {
    const value = credentials?.[key];
    if (value === undefined || value === null) continue;
    const normalizedKey = key.toLowerCase();
    const isRelativeSeconds =
      normalizedKey.includes("retry") ||
      normalizedKey.includes("reset_after") ||
      normalizedKey.includes("restore_after");
    if (value instanceof Date) return parseDateValue(value);
    if (typeof value === "number" && Number.isFinite(value)) {
      return isRelativeSeconds
        ? new Date(Date.now() + value * 1000)
        : parseDateValue(String(value));
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      const numeric = Number(trimmed);
      if (isRelativeSeconds && Number.isFinite(numeric) && numeric > 0) {
        return new Date(Date.now() + numeric * 1000);
      }
      return parseDateValue(trimmed);
    }
  }
  return null;
}

function isFutureDate(value?: Date | null) {
  return Boolean(value && value.getTime() > Date.now());
}

function compactSub2ApiErrorParts(parts: Array<unknown>) {
  const text = parts
    .map((part) => {
      if (typeof part === "string" || typeof part === "number") {
        return String(part).trim();
      }
      if (part && typeof part === "object") {
        try {
          return JSON.stringify(part).slice(0, 600);
        } catch {
          return "";
        }
      }
      return "";
    })
    .filter(Boolean)
    .join(" | ");
  return truncateError(text || null);
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
}

function isSub2ApiOpenAIOAuthRow(row: Sub2ApiAccountRow) {
  return (
    row.platform?.trim().toLowerCase() === "openai" &&
    row.type?.trim().toLowerCase() === "oauth"
  );
}

function mapSub2ApiAccountRow(
  row: Sub2ApiAccountRow
): Sub2ApiTokenAccount | null {
  if (!isSub2ApiOpenAIOAuthRow(row)) return null;

  const credentials = row.credentials || {};
  const sourceData = mergedSub2ApiData(row, credentials);
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
  const oauthFamily = credentialString(credentials, [
    "oauth_family",
    "oauthFamily",
    "token_family",
    "tokenFamily",
    "token_source",
    "tokenSource",
    "source",
  ]);
  const oauthType = credentialString(credentials, [
    "oauth_type",
    "oauthType",
    "auth_type",
    "authType",
  ]);
  const email = credentialString(credentials, [
    "email",
    "account_email",
    "username",
  ]);
  const chatgptAccountId = credentialString(credentials, [
    "chatgpt_account_id",
    "chatgptAccountId",
  ]);
  const planType = credentialString(sourceData, ["plan_type", "planType"]);
  const sourceStatusCode =
    credentialString(sourceData, [
      "status_code",
      "statusCode",
      "error_status",
      "errorStatus",
      "http_status",
      "httpStatus",
      "last_status_code",
      "lastStatusCode",
    ]) || null;
  const sourceError = compactSub2ApiErrorParts([
    sourceStatusCode ? `status_code=${sourceStatusCode}` : null,
    credentialValue(sourceData, [
      "last_error",
      "lastError",
      "error",
      "error_message",
      "errorMessage",
      "status_message",
      "statusMessage",
      "message",
      "detail",
      "reason",
      "disabled_reason",
      "disabledReason",
    ]),
  ]);
  const sourceRateLimitResetAt = credentialDate(sourceData, [
    "rate_limit_reset_at",
    "rateLimitResetAt",
  ]);
  const sourceOverloadUntil = credentialDate(sourceData, [
    "overload_until",
    "overloadUntil",
  ]);
  const sourceTempUnschedulableUntil = credentialDate(sourceData, [
    "temp_unschedulable_until",
    "tempUnschedulableUntil",
  ]);
  const sourceGenericCooldownUntil = credentialDate(sourceData, [
    "cooldown_until",
    "cooldownUntil",
    "cooldown_at",
    "cooldownAt",
    "rate_limit_reset_at",
    "rateLimitResetAt",
    "reset_at",
    "resetAt",
    "restore_at",
    "restoreAt",
    "retry_after",
    "retryAfter",
    "retry_after_seconds",
    "retryAfterSeconds",
  ]);
  const sourceCooldownUntil =
    [
      sourceRateLimitResetAt,
      sourceOverloadUntil,
      sourceTempUnschedulableUntil,
      sourceGenericCooldownUntil,
    ].find(isFutureDate) ||
    sourceRateLimitResetAt ||
    sourceOverloadUntil ||
    sourceTempUnschedulableUntil ||
    sourceGenericCooldownUntil;
  const sourceUpdatedAt = credentialDate(sourceData, [
    "updated_at",
    "updatedAt",
  ]);
  const sourceId = String(row.id);
  const name = row.name?.trim() || email || `Sub2API 账号 ${sourceId}`;

  return {
    sourceId,
    name,
    email: email || null,
    chatgptAccountId: chatgptAccountId || null,
    codexAccessToken: codexAccessToken || null,
    refreshToken: refreshToken || null,
    clientId: clientId || null,
    oauthFamily: oauthFamily || null,
    oauthType: oauthType || null,
    priority: row.priority,
    concurrency: row.concurrency,
    planType: planType || null,
    groupNames: asStringArray(row.group_names),
    sourceStatus: row.status?.trim() || null,
    sourceSchedulable: row.schedulable,
    sourceError,
    sourceStatusCode,
    sourceRateLimitResetAt,
    sourceOverloadUntil,
    sourceTempUnschedulableUntil,
    sourceCooldownUntil,
    sourceUpdatedAt,
  };
}

function isSub2ApiMobileRtAccount(account: Sub2ApiTokenAccount) {
  const markers = [account.clientId, account.oauthFamily, account.oauthType]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  return (
    markers.includes(OPENAI_MOBILE_RT_CLIENT_ID.toLowerCase()) ||
    markers.some(
      (value) =>
        value.includes("mobile") ||
        value.includes("ios") ||
        value.includes("iphone")
    )
  );
}

function isSub2ApiLimitedStatus(status?: string | null) {
  const normalized = status?.trim().toLowerCase() || "";
  return (
    normalized === "limited" ||
    normalized === "rate_limited" ||
    normalized === "rate-limited" ||
    normalized === "quota_exceeded" ||
    normalized === "quota-exceeded" ||
    normalized === "cooldown" ||
    normalized === "cooling" ||
    normalized === "cooling_down" ||
    normalized === "cooling-down"
  );
}

function isSub2ApiErrorStatus(status?: string | null) {
  const normalized = status?.trim().toLowerCase() || "";
  return (
    normalized === "error" ||
    normalized === "failed" ||
    normalized === "invalid" ||
    normalized === "invalidated" ||
    normalized === "token_invalidated" ||
    normalized === "token-invalidated" ||
    normalized === "revoked" ||
    normalized === "token_revoked" ||
    normalized === "token-revoked" ||
    normalized === "unauthorized" ||
    normalized === "auth_error" ||
    normalized === "auth-error" ||
    normalized === "auth_failed" ||
    normalized === "auth-failed" ||
    normalized === "deactivated" ||
    normalized === "deleted" ||
    normalized === "disabled" ||
    normalized === "inactive" ||
    normalized === "banned"
  );
}

function sub2ApiStatusCodeNumber(value?: string | null) {
  const match = value?.match(/\d{3}/)?.[0];
  return match ? Number(match) : null;
}

function buildSub2ApiHealthMessage(account: Sub2ApiTokenAccount) {
  const parts = [
    account.sourceStatus ? `sub_status=${account.sourceStatus}` : null,
    account.sourceSchedulable === false ? "sub_schedulable=false" : null,
    account.sourceStatusCode ? `status_code=${account.sourceStatusCode}` : null,
    account.sourceError,
  ];
  return compactSub2ApiErrorParts(parts);
}

async function getSub2ApiHealthOverride(account: Sub2ApiTokenAccount): Promise<{
  status: "active" | "limited" | "error" | "disabled" | null;
  cooldownUntil?: Date | null;
  lastError?: string | null;
  isEnabled?: boolean;
}> {
  const message = buildSub2ApiHealthMessage(account);
  const combined = [
    account.sourceStatus,
    account.sourceStatusCode,
    account.sourceError,
  ]
    .filter(Boolean)
    .join(" ");
  const lowerCombined = combined.toLowerCase();
  const statusCode = sub2ApiStatusCodeNumber(account.sourceStatusCode);
  const futureRateLimitReset = isFutureDate(account.sourceRateLimitResetAt);
  const futureOverloadUntil = isFutureDate(account.sourceOverloadUntil);
  const futureTempUnschedulableUntil = isFutureDate(
    account.sourceTempUnschedulableUntil
  );

  if (
    account.sourceStatus?.trim().toLowerCase() === "disabled" ||
    account.sourceStatus?.trim().toLowerCase() === "inactive"
  ) {
    return {
      status: "disabled",
      cooldownUntil: account.sourceCooldownUntil,
      lastError: message || "Sub2API 标记账号不可调度",
      isEnabled: false,
    };
  }

  if (isInvalidBackendCredentialError(combined)) {
    return {
      status: "error",
      cooldownUntil: null,
      lastError: message || "Sub2API 标记账号错误",
    };
  }

  if (
    isSub2ApiLimitedStatus(account.sourceStatus) ||
    isUsageLimitBackendError(combined) ||
    futureRateLimitReset ||
    statusCode === 429 ||
    /(?:^|\D)429(?:\D|$)/.test(combined) ||
    lowerCombined.includes("rate limit")
  ) {
    const minutes = await getBackendCooldownMinutes(
      isUsageLimitBackendError(combined)
        ? "IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES"
        : "IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES"
    );
    const fallbackCooldown = cooldownFromMinutes(minutes);
    return {
      status: "limited",
      cooldownUntil:
        account.sourceRateLimitResetAt ||
        (isMeaningfulSourceCooldownForError(
          message,
          account.sourceCooldownUntil
        )
          ? account.sourceCooldownUntil
          : fallbackCooldown),
      lastError: message || "Sub2API 标记账号限流",
    };
  }

  if (
    isSub2ApiErrorStatus(account.sourceStatus) ||
    isInvalidBackendCredentialError(combined) ||
    isUnsupportedModelBackendError(combined) ||
    statusCode === 401 ||
    statusCode === 403
  ) {
    return {
      status: "error",
      cooldownUntil: null,
      lastError: message || "Sub2API 标记账号错误",
    };
  }

  if (
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    statusCode === 529 ||
    isOverloadBackendError(combined) ||
    isRecoverableBackendError(combined)
  ) {
    const minutes = await getBackendCooldownMinutes(
      isOverloadBackendError(combined) || statusCode === 529
        ? "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES"
        : "IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES"
    );
    return {
      status: "active",
      cooldownUntil:
        (futureOverloadUntil
          ? account.sourceOverloadUntil
          : futureTempUnschedulableUntil
            ? account.sourceTempUnschedulableUntil
            : null) || cooldownFromMinutes(minutes),
      lastError: message || "Sub2API 标记账号临时不可用",
    };
  }

  if (account.sourceSchedulable === false) {
    return {
      status: "disabled",
      cooldownUntil: account.sourceCooldownUntil,
      lastError: message || "Sub2API 标记账号不可调度",
      isEnabled: false,
    };
  }

  return {
    status: null,
  };
}

async function getExistingSub2ApiSyncedAccountState(
  sourceAccountId: string,
  mode: ImageBackendAccountBackend
) {
  const [existing] = await db
    .select({
      id: imageBackendAccount.id,
      status: imageBackendAccount.status,
      cooldownUntil: imageBackendAccount.cooldownUntil,
      lastError: imageBackendAccount.lastError,
      lastErrorAt: imageBackendAccount.lastErrorAt,
      isEnabled: imageBackendAccount.isEnabled,
    })
    .from(imageBackendAccount)
    .where(
      and(
        eq(imageBackendAccount.implementationMode, mode),
        sql`${imageBackendAccount.metadata}->>'source' = 'sub2api_postgres'`,
        sql`${imageBackendAccount.metadata}->>'sourceAccountId' = ${sourceAccountId}`
      )
    )
    .limit(1);
  return existing ?? null;
}

async function deleteDuplicateSub2ApiSyncedAccounts(
  sourceAccountId: string,
  mode: ImageBackendAccountBackend,
  keepId: string
) {
  const duplicates = await db
    .select({ id: imageBackendAccount.id })
    .from(imageBackendAccount)
    .where(
      and(
        eq(imageBackendAccount.implementationMode, mode),
        sql`${imageBackendAccount.metadata}->>'source' = 'sub2api_postgres'`,
        sql`${imageBackendAccount.metadata}->>'sourceAccountId' = ${sourceAccountId}`
      )
    );
  const duplicateIds = duplicates
    .map((row) => row.id)
    .filter((id) => id !== keepId);
  if (!duplicateIds.length) return 0;
  const deleted = await db
    .delete(imageBackendAccount)
    .where(inArray(imageBackendAccount.id, duplicateIds))
    .returning({ id: imageBackendAccount.id });
  return deleted.length;
}

async function shouldPreserveLocalUnavailableState(
  existing?: {
    status: string;
    cooldownUntil: Date | null;
    isEnabled: boolean;
    lastError?: string | null;
  } | null
) {
  if (!existing) return false;
  if (!existing.isEnabled) return true;
  if (existing.status === "error" || existing.status === "limited") {
    return true;
  }
  if (
    !existing.cooldownUntil ||
    existing.cooldownUntil.getTime() <= Date.now()
  ) {
    return false;
  }

  const error = existing.lastError || "";
  if (!error) return true;
  if (isResetAwareLimitedBackendError(error)) return true;

  const cooldownKey = isUnsupportedModelBackendError(error)
    ? "IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES"
    : isOverloadBackendError(error)
      ? "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES"
      : isRecoverableBackendError(error)
        ? "IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES"
        : null;
  if (!cooldownKey) return true;

  const minutes = await getBackendCooldownMinutes(cooldownKey);
  const graceMs = 60_000;
  return (
    existing.cooldownUntil.getTime() <=
    Date.now() + Math.max(1, minutes) * 60_000 + graceMs
  );
}

async function normalizeSyncedAccountCooldown(input: {
  status: string;
  cooldownUntil: Date | null;
  lastError?: string | null;
}) {
  if (input.status !== "limited" || input.cooldownUntil) {
    return input.cooldownUntil;
  }

  const error = input.lastError || "";
  const key = isUsageLimitBackendError(error)
    ? "IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES"
    : "IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES";
  const minutes = await getBackendCooldownMinutes(key);
  return cooldownFromMinutes(minutes);
}

async function resolveSyncedAccountHealth(
  account: Sub2ApiTokenAccount,
  existing?: {
    status: string;
    cooldownUntil: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
    isEnabled: boolean;
  } | null,
  options?: { overwriteLocalUnavailableState?: boolean }
) {
  const sourceHealth = await getSub2ApiHealthOverride(account);
  const overwriteLocalUnavailableState =
    options?.overwriteLocalUnavailableState !== false;
  const now = new Date();
  const existingUnavailable = Boolean(
    existing &&
      (!existing.isEnabled ||
        existing.status === "error" ||
        existing.status === "limited" ||
        (existing.cooldownUntil &&
          existing.cooldownUntil.getTime() > now.getTime()))
  );
  const localErrorIsNewerThanSource = Boolean(
    existing?.lastErrorAt &&
      (!account.sourceUpdatedAt ||
        existing.lastErrorAt.getTime() > account.sourceUpdatedAt.getTime())
  );
  const preserveNewerLocalInvalidCredential =
    !sourceHealth.status &&
    existingUnavailable &&
    localErrorIsNewerThanSource &&
    isInvalidBackendCredentialError(existing?.lastError);
  const preserveLocalUnavailable =
    !sourceHealth.status &&
    (preserveNewerLocalInvalidCredential ||
      (!overwriteLocalUnavailableState &&
        (await shouldPreserveLocalUnavailableState(existing))));
  const rawUpdate = sourceHealth.status
    ? {
        status: sourceHealth.status,
        isEnabled: sourceHealth.isEnabled ?? existing?.isEnabled ?? true,
        cooldownUntil: sourceHealth.cooldownUntil ?? null,
        lastError: sourceHealth.lastError ?? null,
        lastErrorAt: sourceHealth.lastError ? now : null,
      }
    : preserveLocalUnavailable
      ? {
          status: existing!.status,
          isEnabled: existing!.isEnabled,
          cooldownUntil: existing!.cooldownUntil,
          lastError: existing!.lastError,
          lastErrorAt: existing!.lastErrorAt,
        }
      : {
          status: "active",
          isEnabled: true,
          cooldownUntil: null,
          lastError: null,
          lastErrorAt: null,
        };
  const cooldownUntil = await normalizeSyncedAccountCooldown(rawUpdate);
  return { ...rawUpdate, cooldownUntil, preserveLocalUnavailable };
}

function buildSub2ApiAccountMetadata(
  account: Sub2ApiTokenAccount,
  mode: ImageBackendAccountBackend,
  tokenSource: string | null,
  allowMobileRtImport: boolean | undefined,
  preserveLocalUnavailable: boolean,
  syncTaskId?: string | null
) {
  return {
    source: "sub2api_postgres",
    sourceAccountId: account.sourceId,
    chatgptAccountId: account.chatgptAccountId,
    sourceGroups: account.groupNames,
    planType: account.planType,
    syncedAt: new Date().toISOString(),
    sub2apiStatus: account.sourceStatus,
    sub2apiSchedulable: account.sourceSchedulable,
    sub2apiStatusCode: account.sourceStatusCode,
    sub2apiError: account.sourceError,
    sub2apiRateLimitResetAt: account.sourceRateLimitResetAt
      ? account.sourceRateLimitResetAt.toISOString()
      : null,
    sub2apiOverloadUntil: account.sourceOverloadUntil
      ? account.sourceOverloadUntil.toISOString()
      : null,
    sub2apiTempUnschedulableUntil: account.sourceTempUnschedulableUntil
      ? account.sourceTempUnschedulableUntil.toISOString()
      : null,
    sub2apiCooldownUntil: account.sourceCooldownUntil
      ? account.sourceCooldownUntil.toISOString()
      : null,
    sub2apiUpdatedAt: account.sourceUpdatedAt
      ? account.sourceUpdatedAt.toISOString()
      : null,
    localUnavailablePreserved: preserveLocalUnavailable,
    tokenSource,
    sub2apiClientId: account.clientId,
    sub2apiOauthFamily: account.oauthFamily,
    sub2apiOauthType: account.oauthType,
    sub2apiSyncTaskId: syncTaskId || null,
    mobileRtImport: Boolean(allowMobileRtImport && mode === "web"),
    oauthClientId:
      mode === "web"
        ? OPENAI_MOBILE_RT_CLIENT_ID
        : account.clientId || OPENAI_CODEX_OAUTH_CLIENT_ID,
    refreshTokenWrittenBack: false,
  };
}

async function applySub2ApiHealthToExistingAccount(
  existingId: string,
  account: Sub2ApiTokenAccount,
  mode: ImageBackendAccountBackend,
  tokenSource: string | null,
  allowMobileRtImport: boolean | undefined,
  healthUpdate: Awaited<ReturnType<typeof resolveSyncedAccountHealth>>,
  syncTaskId?: string | null
) {
  await db
    .update(imageBackendAccount)
    .set({
      isEnabled: healthUpdate.isEnabled,
      status: healthUpdate.status,
      cooldownUntil: healthUpdate.cooldownUntil,
      lastError: truncateError(healthUpdate.lastError),
      lastErrorAt: healthUpdate.lastErrorAt,
      metadata: buildSub2ApiAccountMetadata(
        account,
        mode,
        tokenSource,
        allowMobileRtImport,
        healthUpdate.preserveLocalUnavailable,
        syncTaskId
      ),
      updatedAt: new Date(),
    })
    .where(eq(imageBackendAccount.id, existingId));
}

async function deleteSub2ApiAccountsMissingFromTask(input: {
  syncTaskId: string;
  modes: readonly ImageBackendAccountBackend[];
  currentSourceIds: string[];
}) {
  const sourceIdExpr = sql<string>`${imageBackendAccount.metadata}->>'sourceAccountId'`;
  const conditions = [
    sql`${imageBackendAccount.metadata}->>'source' = 'sub2api_postgres'`,
    sql`${imageBackendAccount.metadata}->>'sub2apiSyncTaskId' = ${input.syncTaskId}`,
    inArray(imageBackendAccount.implementationMode, [...input.modes]),
    input.currentSourceIds.length
      ? notInArray(sourceIdExpr, input.currentSourceIds)
      : undefined,
  ].filter(Boolean);

  const deleted = await db
    .delete(imageBackendAccount)
    .where(and(...conditions))
    .returning({ id: imageBackendAccount.id });
  return deleted.length;
}

async function getOptionalSub2ApiPostgresConnectionString() {
  const connectionString =
    (await getRuntimeSettingString("SUB2API_POSTGRES_URL")) ||
    process.env.SUB2API_POSTGRES_URL?.trim();
  return connectionString || "";
}

export async function isSub2ApiPostgresConfigured() {
  return Boolean(await getOptionalSub2ApiPostgresConnectionString());
}

async function getSub2ApiPostgresConnectionString() {
  const connectionString = await getOptionalSub2ApiPostgresConnectionString();
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
  options: {
    limit: number;
    offset?: number;
    sourceGroupId?: string | null;
    planFilter?: Sub2ApiPlanFilter;
  }
) {
  const sourceGroupId = options.sourceGroupId
    ? Number(options.sourceGroupId)
    : null;
  if (options.sourceGroupId && !Number.isFinite(sourceGroupId)) {
    throw new Error("Sub2API 来源分组无效");
  }
  const planFilter = normalizeSub2ApiPlanFilter(options.planFilter);
  const offset = Math.max(0, Math.trunc(options.offset || 0));
  const result = await pool.query<Sub2ApiAccountRow>(
    `
      SELECT
        a.id,
        a.name,
        a.platform,
        a.type,
        a.status,
        a.schedulable,
        a.error_message,
        a.rate_limit_reset_at,
        a.overload_until,
        a.temp_unschedulable_until,
        a.temp_unschedulable_reason,
        a.session_window_status,
        a.session_window_end,
        a.credentials,
        a.priority,
        a.concurrency,
        to_jsonb(a) - 'credentials' AS row_data,
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
        AND LOWER(a.platform) = 'openai'
        AND LOWER(a.type) = 'oauth'
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
        AND (
          $4::text = 'all'
          OR ($4::text = 'non_free' AND LOWER(COALESCE(a.credentials->>'plan_type', a.credentials->>'planType', '')) <> 'free')
          OR LOWER(COALESCE(a.credentials->>'plan_type', a.credentials->>'planType', '')) = $4::text
        )
      GROUP BY a.id
      ORDER BY a.priority ASC, a.last_used_at ASC NULLS FIRST, a.id ASC
      LIMIT $1
      OFFSET $3
    `,
    [options.limit, sourceGroupId, offset, planFilter]
  );
  return result.rows
    .map(mapSub2ApiAccountRow)
    .filter((account): account is Sub2ApiTokenAccount => Boolean(account));
}

async function countSub2ApiCurrentAccessTokens(
  pool: Pool,
  options: { sourceGroupId?: string | null; planFilter?: Sub2ApiPlanFilter }
) {
  const sourceGroupId = options.sourceGroupId
    ? Number(options.sourceGroupId)
    : null;
  if (options.sourceGroupId && !Number.isFinite(sourceGroupId)) {
    throw new Error("Sub2API 来源分组无效");
  }
  const planFilter = normalizeSub2ApiPlanFilter(options.planFilter);
  const result = await pool.query<{ value: number | string }>(
    `
      SELECT COUNT(*) AS value
      FROM accounts a
      WHERE
        a.deleted_at IS NULL
        AND LOWER(a.platform) = 'openai'
        AND LOWER(a.type) = 'oauth'
        AND (
          a.credentials ? 'access_token'
          OR a.credentials ? 'accessToken'
          OR a.credentials ? 'token'
          OR a.credentials ? 'refresh_token'
          OR a.credentials ? 'refreshToken'
        )
        AND ($1::bigint IS NULL OR EXISTS (
          SELECT 1
          FROM account_groups source_ag
          WHERE source_ag.account_id = a.id
            AND source_ag.group_id = $1::bigint
        ))
        AND (
          $2::text = 'all'
          OR ($2::text = 'non_free' AND LOWER(COALESCE(a.credentials->>'plan_type', a.credentials->>'planType', '')) <> 'free')
          OR LOWER(COALESCE(a.credentials->>'plan_type', a.credentials->>'planType', '')) = $2::text
        )
    `,
    [sourceGroupId, planFilter]
  );
  return Number(result.rows[0]?.value || 0);
}

async function listSub2ApiCurrentAccessTokenSourceIds(
  pool: Pool,
  options: { sourceGroupId?: string | null; planFilter?: Sub2ApiPlanFilter }
) {
  const sourceGroupId = options.sourceGroupId
    ? Number(options.sourceGroupId)
    : null;
  if (options.sourceGroupId && !Number.isFinite(sourceGroupId)) {
    throw new Error("Sub2API 来源分组无效");
  }
  const planFilter = normalizeSub2ApiPlanFilter(options.planFilter);
  const result = await pool.query<{ id: number | string }>(
    `
      SELECT a.id
      FROM accounts a
      WHERE
        a.deleted_at IS NULL
        AND LOWER(a.platform) = 'openai'
        AND LOWER(a.type) = 'oauth'
        AND (
          a.credentials ? 'access_token'
          OR a.credentials ? 'accessToken'
          OR a.credentials ? 'token'
          OR a.credentials ? 'refresh_token'
          OR a.credentials ? 'refreshToken'
        )
        AND ($1::bigint IS NULL OR EXISTS (
          SELECT 1
          FROM account_groups source_ag
          WHERE source_ag.account_id = a.id
            AND source_ag.group_id = $1::bigint
        ))
        AND (
          $2::text = 'all'
          OR ($2::text = 'non_free' AND LOWER(COALESCE(a.credentials->>'plan_type', a.credentials->>'planType', '')) <> 'free')
          OR LOWER(COALESCE(a.credentials->>'plan_type', a.credentials->>'planType', '')) = $2::text
        )
    `,
    [sourceGroupId, planFilter]
  );
  return result.rows.map((row) => String(row.id));
}

function normalizeSub2ApiPlanFilter(value?: string | null): Sub2ApiPlanFilter {
  return value === "free" ||
    value === "plus" ||
    value === "pro" ||
    value === "non_free"
    ? value
    : "all";
}

function asAutoSub2ApiSyncMetadata(
  metadata: Record<string, unknown> | null | undefined
): AutoSub2ApiSyncMetadata {
  return (metadata || {}) as AutoSub2ApiSyncMetadata;
}

function normalizeSub2ApiSyncTask(value: unknown): Sub2ApiAutoSyncTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  const syncMode =
    raw.syncMode === "web" || raw.syncMode === "both"
      ? raw.syncMode
      : "responses";
  const normalizeGroupId = (value: unknown) =>
    typeof value === "string" && value.trim() && value.trim() !== "default"
      ? value.trim()
      : null;
  return {
    id,
    enabled: raw.enabled !== false,
    sourceGroupId:
      typeof raw.sourceGroupId === "string" && raw.sourceGroupId.trim()
        ? raw.sourceGroupId.trim()
        : null,
    sourceGroupName:
      typeof raw.sourceGroupName === "string" && raw.sourceGroupName.trim()
        ? raw.sourceGroupName.trim()
        : null,
    webGroupId: normalizeGroupId(raw.webGroupId),
    responsesGroupId: normalizeGroupId(raw.responsesGroupId),
    syncMode,
    allowMobileRtImport: Boolean(raw.allowMobileRtImport),
    contentSafetyEnabled: raw.contentSafetyEnabled !== false,
    overwriteLocalUnavailableState:
      raw.overwriteLocalUnavailableState !== false,
    planFilter: normalizeSub2ApiPlanFilter(
      typeof raw.planFilter === "string" ? raw.planFilter : null
    ),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : undefined,
    lastResult:
      raw.lastResult && typeof raw.lastResult === "object"
        ? (raw.lastResult as Sub2ApiAutoSyncTask["lastResult"])
        : undefined,
  };
}

async function getSub2ApiAutoSyncTasks() {
  const value = await getRuntimeSettingJson("SUB2API_AUTO_SYNC_TASKS");
  const items = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { tasks?: unknown }).tasks)
      ? (value as { tasks: unknown[] }).tasks
      : [];
  return items
    .map(normalizeSub2ApiSyncTask)
    .filter((task): task is Sub2ApiAutoSyncTask => Boolean(task));
}

async function setSub2ApiAutoSyncTasks(tasks: Sub2ApiAutoSyncTask[]) {
  const now = new Date();
  await db
    .insert(systemSetting)
    .values({
      key: AUTO_SUB2API_SYNC_TASKS_KEY,
      value: tasks,
      isSecret: false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSetting.key,
      set: {
        value: tasks,
        isSecret: false,
        updatedAt: now,
      },
    });
  clearSystemSettingsCache();
}

function buildSub2ApiAutoSyncTaskId(input: {
  sourceGroupId?: string | null;
  syncMode: Sub2ApiTokenSyncMode;
  allowMobileRtImport?: boolean;
  planFilter?: Sub2ApiPlanFilter | null;
}) {
  const key = [
    input.sourceGroupId?.trim() || "all",
    input.allowMobileRtImport ? input.syncMode : "responses",
    input.allowMobileRtImport ? "mobile-allowed" : "codex-only",
    normalizeSub2ApiPlanFilter(input.planFilter),
  ].join("|");
  return `sub2api-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

async function upsertSub2ApiAutoSyncTask(input: {
  sourceGroupId?: string | null;
  sourceGroupName?: string | null;
  webGroupId?: string | null;
  responsesGroupId?: string | null;
  syncMode: Sub2ApiTokenSyncMode;
  allowMobileRtImport?: boolean;
  contentSafetyEnabled: boolean;
  overwriteLocalUnavailableState?: boolean;
  planFilter?: Sub2ApiPlanFilter | null;
}) {
  const now = new Date().toISOString();
  const planFilter = normalizeSub2ApiPlanFilter(input.planFilter);
  const syncMode = input.allowMobileRtImport ? input.syncMode : "responses";
  const id = buildSub2ApiAutoSyncTaskId({
    sourceGroupId: input.sourceGroupId,
    syncMode,
    allowMobileRtImport: input.allowMobileRtImport,
    planFilter,
  });
  const tasks = await getSub2ApiAutoSyncTasks();
  const existing = tasks.find((task) => task.id === id);
  const nextTask: Sub2ApiAutoSyncTask = {
    ...(existing || {}),
    id,
    enabled: true,
    sourceGroupId: input.sourceGroupId?.trim() || null,
    sourceGroupName: input.sourceGroupName?.trim() || null,
    webGroupId:
      input.webGroupId?.trim() && input.webGroupId.trim() !== "default"
        ? input.webGroupId.trim()
        : null,
    responsesGroupId:
      input.responsesGroupId?.trim() &&
      input.responsesGroupId.trim() !== "default"
        ? input.responsesGroupId.trim()
        : null,
    syncMode,
    allowMobileRtImport: Boolean(input.allowMobileRtImport),
    contentSafetyEnabled: input.contentSafetyEnabled,
    overwriteLocalUnavailableState:
      input.overwriteLocalUnavailableState !== false,
    planFilter,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const nextTasks = existing
    ? tasks.map((task) => (task.id === id ? nextTask : task))
    : [...tasks, nextTask];
  await setSub2ApiAutoSyncTasks(nextTasks);
  return nextTask;
}

async function updateSub2ApiAutoSyncTaskResult(
  taskId: string,
  result: NonNullable<Sub2ApiAutoSyncTask["lastResult"]>
) {
  const tasks = await getSub2ApiAutoSyncTasks();
  const now = new Date().toISOString();
  const nextTasks = tasks.map((task) =>
    task.id === taskId
      ? { ...task, lastRunAt: now, updatedAt: now, lastResult: result }
      : task
  );
  await setSub2ApiAutoSyncTasks(nextTasks);
}

async function countAccountsForSub2ApiSyncTask(taskId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(imageBackendAccount)
    .where(
      and(
        sql`${imageBackendAccount.metadata}->>'source' = 'sub2api_postgres'`,
        sql`${imageBackendAccount.metadata}->>'sub2apiSyncTaskId' = ${taskId}`
      )
    );
  return Number(row?.value || 0);
}

export async function listSub2ApiAutoSyncTasksForAdmin(): Promise<
  Sub2ApiAutoSyncTaskSummary[]
> {
  const tasks = await getSub2ApiAutoSyncTasks();
  const counts = await Promise.all(
    tasks.map((task) => countAccountsForSub2ApiSyncTask(task.id))
  );
  return tasks.map((task, index) => ({
    ...task,
    managedAccountCount: counts[index] || 0,
  }));
}

export async function setSub2ApiAutoSyncTaskEnabled(input: {
  taskId: string;
  enabled: boolean;
}) {
  const taskId = input.taskId.trim();
  const tasks = await getSub2ApiAutoSyncTasks();
  let found = false;
  const now = new Date().toISOString();
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) return task;
    found = true;
    return { ...task, enabled: input.enabled, updatedAt: now };
  });
  if (!found) throw new Error("自动同步任务不存在");
  await setSub2ApiAutoSyncTasks(nextTasks);
  return { taskId, enabled: input.enabled };
}

export async function setSub2ApiAutoSyncTaskOverwriteLocalUnavailableState(input: {
  taskId: string;
  overwriteLocalUnavailableState: boolean;
}) {
  const taskId = input.taskId.trim();
  const tasks = await getSub2ApiAutoSyncTasks();
  let found = false;
  const now = new Date().toISOString();
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) return task;
    found = true;
    return {
      ...task,
      overwriteLocalUnavailableState: input.overwriteLocalUnavailableState,
      updatedAt: now,
    };
  });
  if (!found) throw new Error("自动同步任务不存在");
  await setSub2ApiAutoSyncTasks(nextTasks);
  return {
    taskId,
    overwriteLocalUnavailableState: input.overwriteLocalUnavailableState,
  };
}

export async function updateSub2ApiAutoSyncTaskOptions(input: {
  taskId: string;
  enabled: boolean;
  webGroupId?: string | null;
  responsesGroupId?: string | null;
  syncMode: Sub2ApiTokenSyncMode;
  allowMobileRtImport?: boolean;
  contentSafetyEnabled: boolean;
  overwriteLocalUnavailableState: boolean;
  planFilter?: Sub2ApiPlanFilter | null;
}) {
  const taskId = input.taskId.trim();
  const tasks = await getSub2ApiAutoSyncTasks();
  let found = false;
  const allowMobileRtImport = Boolean(input.allowMobileRtImport);
  const syncMode = allowMobileRtImport ? input.syncMode : "responses";
  const now = new Date().toISOString();
  const normalizeGroupId = (value?: string | null) =>
    value?.trim() && value.trim() !== "default" ? value.trim() : null;
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) return task;
    found = true;
    return {
      ...task,
      enabled: input.enabled,
      webGroupId: normalizeGroupId(input.webGroupId),
      responsesGroupId: normalizeGroupId(input.responsesGroupId),
      syncMode,
      allowMobileRtImport,
      contentSafetyEnabled: input.contentSafetyEnabled,
      overwriteLocalUnavailableState: input.overwriteLocalUnavailableState,
      planFilter: normalizeSub2ApiPlanFilter(input.planFilter),
      updatedAt: now,
    };
  });
  if (!found) throw new Error("自动同步任务不存在");
  await setSub2ApiAutoSyncTasks(nextTasks);
  return { taskId };
}

export async function deleteSub2ApiAutoSyncTask(taskIdInput: string) {
  const taskId = taskIdInput.trim();
  const tasks = await getSub2ApiAutoSyncTasks();
  const nextTasks = tasks.filter((task) => task.id !== taskId);
  if (nextTasks.length === tasks.length) {
    throw new Error("自动同步任务不存在");
  }
  await setSub2ApiAutoSyncTasks(nextTasks);
  return { taskId, deleted: true };
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
            AND LOWER(a.platform) = 'openai'
            AND LOWER(a.type) = 'oauth'
            AND (
              a.credentials ? 'access_token'
              OR a.credentials ? 'accessToken'
              OR a.credentials ? 'token'
              OR a.credentials ? 'refresh_token'
              OR a.credentials ? 'refreshToken'
            )
        ) AS account_count
      FROM groups g
      LEFT JOIN account_groups ag ON ag.group_id = g.id
      LEFT JOIN accounts a ON a.id = ag.account_id
      WHERE
        g.deleted_at IS NULL
        AND g.status = 'active'
        AND LOWER(g.platform) = 'openai'
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
          clientId === OPENAI_CODEX_OAUTH_CLIENT_ID ||
          clientId === OPENAI_MOBILE_RT_CLIENT_ID
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

async function resolveSub2ApiAccessTokenForMode(
  account: Sub2ApiTokenAccount,
  mode: ImageBackendAccountBackend,
  options?: { allowMobileRtImport?: boolean }
) {
  if (mode === "responses") {
    if (!options?.allowMobileRtImport && isSub2ApiMobileRtAccount(account)) {
      return {
        accessToken: null,
        tokenSource: "sub2api.mobile_rt_disabled",
        refreshTokenWrittenBack: false,
      };
    }
    return {
      accessToken: account.codexAccessToken,
      tokenSource: isSub2ApiMobileRtAccount(account)
        ? "sub2api.credentials.mobile_access_token"
        : "sub2api.credentials.access_token",
      refreshTokenWrittenBack: false,
    };
  }

  if (!options?.allowMobileRtImport) {
    return {
      accessToken: null,
      tokenSource: "sub2api.mobile_rt_disabled",
      refreshTokenWrittenBack: false,
    };
  }

  if (!isSub2ApiMobileRtAccount(account)) {
    return {
      accessToken: null,
      tokenSource: "sub2api.mobile_rt_not_marked",
      refreshTokenWrittenBack: false,
    };
  }

  if (!account.codexAccessToken) {
    return {
      accessToken: null,
      tokenSource: "sub2api.credentials.access_token",
      refreshTokenWrittenBack: false,
    };
  }

  return {
    accessToken: account.codexAccessToken,
    tokenSource: "sub2api.credentials.mobile_access_token",
    refreshTokenWrittenBack: false,
  };
}

export async function syncImageBackendAccountsFromSub2Api(input: {
  webGroupId?: string | null;
  responsesGroupId?: string | null;
  sourceGroupId?: string | null;
  sourceGroupName?: string | null;
  syncMode: Sub2ApiTokenSyncMode;
  allowMobileRtImport?: boolean;
  contentSafetyEnabled: boolean;
  limit?: number | null;
  offset?: number | null;
  planFilter?: Sub2ApiPlanFilter | null;
  createSyncTask?: boolean;
  syncTaskId?: string | null;
  cleanupManagedAccounts?: boolean;
  overwriteLocalUnavailableState?: boolean;
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
  const offset = Math.max(0, Math.trunc(input.offset || 0));
  const planFilter = normalizeSub2ApiPlanFilter(input.planFilter);
  const effectiveSyncMode = input.allowMobileRtImport
    ? input.syncMode
    : "responses";
  const modes =
    effectiveSyncMode === "both"
      ? (["web", "responses"] as const)
      : ([effectiveSyncMode] as const);
  const syncTask = input.createSyncTask
    ? await upsertSub2ApiAutoSyncTask({
        sourceGroupId: input.sourceGroupId,
        sourceGroupName: input.sourceGroupName,
        webGroupId: input.webGroupId,
        responsesGroupId: input.responsesGroupId,
        syncMode: effectiveSyncMode,
        allowMobileRtImport: input.allowMobileRtImport,
        contentSafetyEnabled: input.contentSafetyEnabled,
        overwriteLocalUnavailableState: input.overwriteLocalUnavailableState,
        planFilter,
      })
    : null;
  const syncTaskId = input.syncTaskId || syncTask?.id || null;
  const imported: string[] = [];
  let deletedCount = 0;
  const syncedByMode = {
    web: 0,
    responses: 0,
  };
  const skipped = {
    web: 0,
    responses: 0,
  };
  const failedByMode = {
    web: 0,
    responses: 0,
  };

  const connectionString = await getSub2ApiPostgresConnectionString();
  const pool = createSub2ApiPool(connectionString);
  try {
    const totalSourceCount = await countSub2ApiCurrentAccessTokens(pool, {
      sourceGroupId: input.sourceGroupId,
      planFilter,
    });
    const accounts = await listSub2ApiCurrentAccessTokens(pool, {
      limit,
      offset,
      sourceGroupId: input.sourceGroupId,
      planFilter,
    });
    for (const account of accounts) {
      for (const mode of modes) {
        try {
          const existing = await getExistingSub2ApiSyncedAccountState(
            account.sourceId,
            mode
          );
          if (existing?.id) {
            deletedCount += await deleteDuplicateSub2ApiSyncedAccounts(
              account.sourceId,
              mode,
              existing.id
            );
          }
          const preTokenHealth = await resolveSyncedAccountHealth(
            account,
            existing,
            {
              overwriteLocalUnavailableState:
                input.overwriteLocalUnavailableState,
            }
          );
          const { accessToken, tokenSource } =
            await resolveSub2ApiAccessTokenForMode(account, mode, {
              allowMobileRtImport: input.allowMobileRtImport,
            });
          if (!accessToken) {
            if (
              existing?.id &&
              (preTokenHealth.status !== "active" ||
                preTokenHealth.cooldownUntil ||
                preTokenHealth.lastError ||
                preTokenHealth.isEnabled === false)
            ) {
              await applySub2ApiHealthToExistingAccount(
                existing.id,
                account,
                mode,
                tokenSource,
                input.allowMobileRtImport,
                preTokenHealth,
                syncTaskId
              );
              await setImageBackendAccountGroups({
                accountId: existing.id,
                groupIds: accountGroupIdsFromInput({
                  groupId:
                    mode === "responses"
                      ? input.responsesGroupId
                      : input.webGroupId,
                }),
                replace: false,
              });
              imported.push(existing.id);
              syncedByMode[mode]++;
              continue;
            }
            skipped[mode]++;
            continue;
          }
          const healthUpdate = await resolveSyncedAccountHealth(
            account,
            existing,
            {
              overwriteLocalUnavailableState:
                input.overwriteLocalUnavailableState,
            }
          );
          const id = await upsertImageBackendAccount({
            id: existing?.id,
            groupId:
              mode === "responses" ? input.responsesGroupId : input.webGroupId,
            mergeGroupIds: true,
            name:
              mode === "responses"
                ? `${account.name} / Codex`
                : `${account.name} / Web`,
            email: account.email,
            accessToken,
            implementationMode: mode,
            model: null,
            contentSafetyEnabled: input.contentSafetyEnabled,
            isEnabled: healthUpdate.isEnabled,
            priority: account.priority ?? 50,
            concurrency: Math.max(1, Math.min(100, account.concurrency ?? 1)),
            status: healthUpdate.status,
            cooldownUntil: healthUpdate.cooldownUntil,
            lastError: healthUpdate.lastError,
            lastErrorAt: healthUpdate.lastErrorAt,
            metadata: buildSub2ApiAccountMetadata(
              account,
              mode,
              tokenSource,
              input.allowMobileRtImport,
              healthUpdate.preserveLocalUnavailable,
              syncTaskId
            ),
          });
          imported.push(id);
          syncedByMode[mode]++;
        } catch (error) {
          failedByMode[mode]++;
          logWarn("Sub2API 账号 AT 同步失败，已跳过", {
            sourceAccountId: account.sourceId,
            mode,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (
      syncTaskId &&
      input.cleanupManagedAccounts &&
      offset + accounts.length >= totalSourceCount
    ) {
      const currentSourceIds = await listSub2ApiCurrentAccessTokenSourceIds(
        pool,
        {
          sourceGroupId: input.sourceGroupId,
          planFilter,
        }
      );
      deletedCount = await deleteSub2ApiAccountsMissingFromTask({
        syncTaskId,
        modes,
        currentSourceIds,
      });
    }

    return {
      sourceCount: accounts.length,
      totalSourceCount,
      offset,
      nextOffset: offset + accounts.length,
      hasMore: offset + accounts.length < totalSourceCount,
      syncedCount: imported.length,
      syncedByMode,
      skipped,
      failed: failedByMode.web + failedByMode.responses,
      failedByMode,
      deletedCount,
      syncTaskId,
      refreshTokenWriteBackCount: 0,
    };
  } finally {
    await pool.end();
  }
}

async function getDefaultGroupIdForBackend(
  backend: ImageBackendAccountBackend
) {
  const rows = await db
    .select({
      id: imageBackendGroup.id,
      isDefault: imageBackendGroup.isDefault,
      metadata: imageBackendGroup.metadata,
      priority: imageBackendGroup.priority,
      createdAt: imageBackendGroup.createdAt,
    })
    .from(imageBackendGroup)
    .where(eq(imageBackendGroup.isEnabled, true))
    .orderBy(
      desc(imageBackendGroup.isDefault),
      asc(imageBackendGroup.priority),
      asc(imageBackendGroup.createdAt)
    );
  return (
    rows.find((group) => groupBackendAllowsAccount(group.metadata, backend))
      ?.id ?? null
  );
}

async function getAutoSub2ApiSyncMetadata() {
  const [row] = await db
    .select({ value: systemSetting.value })
    .from(systemSetting)
    .where(eq(systemSetting.key, AUTO_SUB2API_SYNC_STATE_KEY))
    .limit(1);
  return asAutoSub2ApiSyncMetadata(
    row?.value && typeof row.value === "object"
      ? (row.value as Record<string, unknown>)
      : undefined
  );
}

async function setAutoSub2ApiSyncMetadata(metadata: AutoSub2ApiSyncMetadata) {
  const now = new Date();
  await db
    .insert(systemSetting)
    .values({
      key: AUTO_SUB2API_SYNC_STATE_KEY,
      value: metadata,
      isSecret: false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSetting.key,
      set: {
        value: metadata,
        isSecret: false,
        updatedAt: now,
      },
    });
}

function shouldRunAutoSub2ApiSync(
  metadata: AutoSub2ApiSyncMetadata,
  intervalMinutes: number,
  force: boolean
) {
  if (force) return { run: true, nextRunAt: null as string | null };
  const lastSuccessAt = metadata.lastSuccessAt
    ? Date.parse(metadata.lastSuccessAt)
    : Number.NaN;
  if (!Number.isFinite(lastSuccessAt)) {
    return { run: true, nextRunAt: null as string | null };
  }
  const nextRunAtMs = lastSuccessAt + intervalMinutes * 60_000;
  if (Date.now() >= nextRunAtMs) {
    return { run: true, nextRunAt: new Date(nextRunAtMs).toISOString() };
  }
  return { run: false, nextRunAt: new Date(nextRunAtMs).toISOString() };
}

function createSub2ApiSyncAggregate() {
  return {
    sourceCount: 0,
    totalSourceCount: 0,
    syncedCount: 0,
    syncedByMode: { web: 0, responses: 0 },
    skipped: { web: 0, responses: 0 },
    failed: 0,
    failedByMode: { web: 0, responses: 0 },
    deletedCount: 0,
    refreshTokenWriteBackCount: 0,
    batches: 0,
  };
}

async function runSub2ApiSyncConfig(input: {
  sourceGroupId?: string | null;
  sourceGroupName?: string | null;
  webGroupId?: string | null;
  responsesGroupId?: string | null;
  syncMode: Sub2ApiTokenSyncMode;
  allowMobileRtImport?: boolean;
  contentSafetyEnabled: boolean;
  planFilter: Sub2ApiPlanFilter;
  limit: number;
  syncTaskId?: string | null;
  cleanupManagedAccounts?: boolean;
  overwriteLocalUnavailableState?: boolean;
}) {
  let offset = 0;
  let hasMore = true;
  const aggregate = createSub2ApiSyncAggregate();

  while (hasMore) {
    const result = await syncImageBackendAccountsFromSub2Api({
      webGroupId: input.webGroupId,
      responsesGroupId: input.responsesGroupId,
      sourceGroupId: input.sourceGroupId,
      sourceGroupName: input.sourceGroupName,
      syncMode: input.syncMode,
      allowMobileRtImport: input.allowMobileRtImport,
      contentSafetyEnabled: input.contentSafetyEnabled,
      planFilter: input.planFilter,
      limit: input.limit,
      offset,
      syncTaskId: input.syncTaskId,
      cleanupManagedAccounts: input.cleanupManagedAccounts,
      overwriteLocalUnavailableState: input.overwriteLocalUnavailableState,
    });
    aggregate.sourceCount += result.sourceCount;
    aggregate.totalSourceCount = result.totalSourceCount;
    aggregate.syncedCount += result.syncedCount;
    aggregate.syncedByMode.web += result.syncedByMode.web;
    aggregate.syncedByMode.responses += result.syncedByMode.responses;
    aggregate.skipped.web += result.skipped.web;
    aggregate.skipped.responses += result.skipped.responses;
    aggregate.failed += result.failed;
    aggregate.failedByMode.web += result.failedByMode.web;
    aggregate.failedByMode.responses += result.failedByMode.responses;
    aggregate.deletedCount += result.deletedCount;
    aggregate.refreshTokenWriteBackCount += result.refreshTokenWriteBackCount;
    aggregate.batches++;
    hasMore = result.hasMore && result.sourceCount > 0;
    offset = result.nextOffset;
  }

  return aggregate;
}

async function getSub2ApiSyncBatchLimit() {
  const configuredLimit = await getRuntimeSettingNumber(
    "SUB2API_POSTGRES_SYNC_LIMIT",
    100,
    {
      positive: true,
    }
  );
  return Math.max(1, Math.min(500, Math.trunc(configuredLimit)));
}

async function runSub2ApiAutoSyncTaskConfig(
  task: Sub2ApiAutoSyncTask,
  limit: number
) {
  const effectiveSyncMode = task.allowMobileRtImport
    ? task.syncMode
    : "responses";
  const [webGroupId, responsesGroupId] = await Promise.all([
    effectiveSyncMode === "web" || effectiveSyncMode === "both"
      ? task.webGroupId || getDefaultGroupIdForBackend("web")
      : Promise.resolve(null),
    effectiveSyncMode === "responses" || effectiveSyncMode === "both"
      ? task.responsesGroupId || getDefaultGroupIdForBackend("responses")
      : Promise.resolve(null),
  ]);

  return runSub2ApiSyncConfig({
    webGroupId,
    responsesGroupId,
    sourceGroupId: task.sourceGroupId,
    sourceGroupName: task.sourceGroupName,
    syncMode: effectiveSyncMode,
    allowMobileRtImport: task.allowMobileRtImport,
    contentSafetyEnabled: task.contentSafetyEnabled,
    planFilter: task.planFilter,
    limit,
    syncTaskId: task.id,
    cleanupManagedAccounts: true,
    overwriteLocalUnavailableState: task.overwriteLocalUnavailableState,
  });
}

function toSub2ApiAutoSyncTaskLastResult(
  result: Awaited<ReturnType<typeof runSub2ApiSyncConfig>>
): NonNullable<Sub2ApiAutoSyncTask["lastResult"]> {
  return {
    sourceCount: result.sourceCount,
    totalSourceCount: result.totalSourceCount,
    syncedCount: result.syncedCount,
    syncedByMode: result.syncedByMode,
    skipped: result.skipped,
    failed: result.failed,
    failedByMode: result.failedByMode,
    deletedCount: result.deletedCount,
  };
}

export async function runSub2ApiAutoSyncTaskNow(taskIdInput: string) {
  if (!(await getOptionalSub2ApiPostgresConnectionString())) {
    throw new Error("请先配置 SUB2API_POSTGRES_URL");
  }

  const taskId = taskIdInput.trim();
  const tasks = await getSub2ApiAutoSyncTasks();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("自动同步任务不存在");

  const limit = await getSub2ApiSyncBatchLimit();
  const result = await runSub2ApiAutoSyncTaskConfig(task, limit);
  const lastResult = toSub2ApiAutoSyncTaskLastResult(result);
  await updateSub2ApiAutoSyncTaskResult(task.id, lastResult);

  return {
    success: true,
    taskId: task.id,
    ...result,
    timestamp: new Date().toISOString(),
  };
}

export async function runAutoSub2ApiAccessTokenSync(options?: {
  force?: boolean;
}) {
  const enabled = await getRuntimeSettingBoolean(
    "SUB2API_AUTO_SYNC_ENABLED",
    true
  );
  if (!enabled && !options?.force) {
    return {
      success: true,
      jobSkipped: true,
      reason: "disabled",
      intervalMinutes: 0,
      timestamp: new Date().toISOString(),
    };
  }

  if (!(await getOptionalSub2ApiPostgresConnectionString())) {
    const skippedAt = new Date().toISOString();
    const previousMetadata = await getAutoSub2ApiSyncMetadata();
    await setAutoSub2ApiSyncMetadata({
      ...previousMetadata,
      lastSkippedAt: skippedAt,
      lastStatus: "skipped",
      lastError: undefined,
      lastErrorAt: undefined,
    });
    return {
      success: true,
      jobSkipped: true,
      reason: "sub2api_not_configured",
      intervalMinutes: 0,
      timestamp: skippedAt,
    };
  }

  const intervalMinutes = Math.max(
    1,
    Math.trunc(
      await getRuntimeSettingNumber("SUB2API_AUTO_SYNC_INTERVAL_MINUTES", 720, {
        positive: true,
      })
    )
  );
  const previousMetadata = await getAutoSub2ApiSyncMetadata();
  const schedule = shouldRunAutoSub2ApiSync(
    previousMetadata,
    intervalMinutes,
    Boolean(options?.force)
  );
  if (!schedule.run) {
    const metadata = {
      ...previousMetadata,
      lastSkippedAt: new Date().toISOString(),
      lastStatus: "skipped" as const,
    };
    await setAutoSub2ApiSyncMetadata(metadata);
    return {
      success: true,
      jobSkipped: true,
      reason: "interval_not_reached",
      intervalMinutes,
      lastSuccessAt: previousMetadata.lastSuccessAt ?? null,
      nextRunAt: schedule.nextRunAt,
      timestamp: metadata.lastSkippedAt,
    };
  }

  const startedAt = new Date().toISOString();
  await setAutoSub2ApiSyncMetadata({
    ...previousMetadata,
    lastStartedAt: startedAt,
  });

  try {
    const [limit, configuredTasks] = await Promise.all([
      getSub2ApiSyncBatchLimit(),
      getSub2ApiAutoSyncTasks(),
    ]);
    const enabledTasks = configuredTasks.filter((task) => task.enabled);
    const aggregate = createSub2ApiSyncAggregate();
    const taskResults: NonNullable<
      NonNullable<AutoSub2ApiSyncMetadata["lastResult"]>["tasks"]
    > = [];

    if (enabledTasks.length) {
      for (const task of enabledTasks) {
        const result = await runSub2ApiAutoSyncTaskConfig(task, limit);
        aggregate.sourceCount += result.sourceCount;
        aggregate.totalSourceCount += result.totalSourceCount;
        aggregate.syncedCount += result.syncedCount;
        aggregate.syncedByMode.web += result.syncedByMode.web;
        aggregate.syncedByMode.responses += result.syncedByMode.responses;
        aggregate.skipped.web += result.skipped.web;
        aggregate.skipped.responses += result.skipped.responses;
        aggregate.failed += result.failed;
        aggregate.failedByMode.web += result.failedByMode.web;
        aggregate.failedByMode.responses += result.failedByMode.responses;
        aggregate.deletedCount += result.deletedCount;
        aggregate.refreshTokenWriteBackCount +=
          result.refreshTokenWriteBackCount;
        aggregate.batches += result.batches;
        taskResults.push({
          id: task.id,
          sourceGroupId: task.sourceGroupId,
          sourceGroupName: task.sourceGroupName,
          sourceCount: result.sourceCount,
          totalSourceCount: result.totalSourceCount,
          syncedCount: result.syncedCount,
          failed: result.failed,
          deletedCount: result.deletedCount,
        });
        await updateSub2ApiAutoSyncTaskResult(
          task.id,
          toSub2ApiAutoSyncTaskLastResult(result)
        );
      }
    } else {
      const [sourceGroupId, syncMode, allowMobileRtImport, planFilter] =
        await Promise.all([
          getRuntimeSettingString("SUB2API_AUTO_SYNC_SOURCE_GROUP_ID"),
          getRuntimeSettingSelect(
            "SUB2API_AUTO_SYNC_MODE",
            ["web", "responses", "both"] as const,
            "responses"
          ),
          getRuntimeSettingBoolean("SUB2API_AUTO_SYNC_ALLOW_MOBILE_RT", false),
          getRuntimeSettingSelect(
            "SUB2API_AUTO_SYNC_PLAN_FILTER",
            ["all", "free", "plus", "pro", "non_free"] as const,
            "non_free"
          ),
        ]);
      const effectiveSyncMode = allowMobileRtImport ? syncMode : "responses";
      const [webGroupId, responsesGroupId] = await Promise.all([
        effectiveSyncMode === "web" || effectiveSyncMode === "both"
          ? getDefaultGroupIdForBackend("web")
          : Promise.resolve(null),
        effectiveSyncMode === "responses" || effectiveSyncMode === "both"
          ? getDefaultGroupIdForBackend("responses")
          : Promise.resolve(null),
      ]);
      const result = await runSub2ApiSyncConfig({
        webGroupId,
        responsesGroupId,
        sourceGroupId,
        syncMode: effectiveSyncMode,
        allowMobileRtImport,
        contentSafetyEnabled: true,
        planFilter,
        limit,
      });
      Object.assign(aggregate, result);
    }

    const finishedAt = new Date().toISOString();
    const metadata: AutoSub2ApiSyncMetadata = {
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastSuccessAt: finishedAt,
      lastStatus: "success",
      lastResult: {
        ...aggregate,
        tasks: taskResults,
      },
    };
    await setAutoSub2ApiSyncMetadata(metadata);

    return {
      success: true,
      jobSkipped: false,
      intervalMinutes,
      taskCount: enabledTasks.length,
      ...aggregate,
      tasks: taskResults,
      timestamp: finishedAt,
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message =
      error instanceof Error ? error.message : "Sub2API 自动同步失败";
    await setAutoSub2ApiSyncMetadata({
      ...previousMetadata,
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastErrorAt: finishedAt,
      lastStatus: "error",
      lastError: message,
    });
    throw error;
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
    .orderBy(
      asc(imageBackendAccount.lastErrorAt),
      asc(imageBackendAccount.lastUsedAt)
    )
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
  interfaceMode?: ImageBackendApiInterfaceMode;
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
    interfaceMode: normalizeImageBackendApiInterfaceMode(input.interfaceMode),
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
  let deletedAccountCount = 0;
  let deletedApiCount = 0;
  if (input.accountIds?.length) {
    const accountIds = Array.from(new Set(input.accountIds.filter(Boolean)));
    for (let index = 0; index < accountIds.length; index += 500) {
      const chunk = accountIds.slice(index, index + 500);
      if (!chunk.length) continue;
      await db
        .delete(imageBackendAccount)
        .where(inArray(imageBackendAccount.id, chunk));
      deletedAccountCount += chunk.length;
    }
  }
  if (input.apiIds?.length) {
    const apiIds = Array.from(new Set(input.apiIds.filter(Boolean)));
    for (let index = 0; index < apiIds.length; index += 500) {
      const chunk = apiIds.slice(index, index + 500);
      if (!chunk.length) continue;
      await db
        .delete(imageBackendApi)
        .where(inArray(imageBackendApi.id, chunk));
      deletedApiCount += chunk.length;
    }
  }
  return { deletedAccountCount, deletedApiCount };
}

export async function listAdminImageBackendPool() {
  const groups = await db
    .select()
    .from(imageBackendGroup)
    .orderBy(asc(imageBackendGroup.priority), asc(imageBackendGroup.createdAt));
  const accountCounts = await db
    .select({ groupId: imageBackendAccountGroup.groupId, value: count() })
    .from(imageBackendAccountGroup)
    .groupBy(imageBackendAccountGroup.groupId);
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
    backendType: getGroupBackendType(group.metadata),
    minPlan: getGroupMinPlan(group.metadata),
    billingMultiplier: getGroupBillingMultiplier(group.metadata),
    childGroupIds: getGroupChildGroupIds(group.metadata),
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
    .orderBy(
      asc(imageBackendAccount.priority),
      desc(imageBackendAccount.createdAt)
    );
  const accountGroupRows = accounts.length
    ? await db
        .select({
          accountId: imageBackendAccountGroup.accountId,
          groupId: imageBackendAccountGroup.groupId,
        })
        .from(imageBackendAccountGroup)
        .where(
          inArray(
            imageBackendAccountGroup.accountId,
            accounts.map((account) => account.id)
          )
        )
    : [];
  const accountGroupIdMap = new Map<string, string[]>();
  for (const row of accountGroupRows) {
    const current = accountGroupIdMap.get(row.accountId) || [];
    current.push(row.groupId);
    accountGroupIdMap.set(row.accountId, current);
  }

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
    accounts: accounts.map((account) => ({
      ...account,
      groupIds:
        accountGroupIdMap.get(account.id) ||
        normalizeAccountGroupIds(account.groupId ? [account.groupId] : []),
    })),
    apis,
  };
}
