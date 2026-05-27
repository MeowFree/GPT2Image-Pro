import { db } from "@repo/database";
import { systemSetting } from "@repo/database/schema";
import { eq, inArray, sql } from "drizzle-orm";

import {
  SETTING_DEFINITION_BY_KEY,
  SYSTEM_SETTING_DEFINITIONS,
  type SettingDefinition,
  type SettingKey,
  isSettingKey,
} from "./definitions";

export {
  SETTING_CATEGORIES,
  SETTING_DEFINITION_BY_KEY,
  SYSTEM_SETTING_DEFINITIONS,
  type SettingCategory,
  type SettingDefinition,
  type SettingKey,
  type SettingValueType,
} from "./definitions";

const CACHE_TTL_MS = 10_000;

let settingsCache:
  | {
      expiresAt: number;
      values: Map<string, unknown>;
    }
  | undefined;

function normalizeStoredValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return value;
}

async function loadSystemSettingsMap() {
  const now = Date.now();
  if (settingsCache && settingsCache.expiresAt > now) {
    return settingsCache.values;
  }

  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting);

  const values = new Map<string, unknown>();
  for (const row of rows) {
    const normalized = normalizeStoredValue(row.value);
    if (normalized !== undefined) {
      values.set(row.key, normalized);
    }
  }

  settingsCache = {
    expiresAt: now + CACHE_TTL_MS,
    values,
  };

  return values;
}

export function clearSystemSettingsCache() {
  settingsCache = undefined;
}

export async function getSystemSettingValue(
  key: SettingKey
): Promise<unknown | undefined> {
  const values = await loadSystemSettingsMap();
  return values.get(key);
}

function parseJsonText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed) as unknown;
}

export async function getRuntimeSettingJson(key: SettingKey) {
  const value = await getSystemSettingValue(key);
  if (value !== undefined) {
    if (typeof value === "string") return parseJsonText(value);
    return value;
  }

  const envValue = process.env[key];
  if (!envValue?.trim()) return undefined;
  return parseJsonText(envValue);
}

export async function getSystemSettingString(key: SettingKey) {
  const value = await getSystemSettingValue(key);
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export async function getRuntimeSettingString(key: SettingKey) {
  const value = await getSystemSettingString(key);
  return value ?? (process.env[key]?.trim() || undefined);
}

export async function getRuntimeSettingBoolean(
  key: SettingKey,
  fallback = false
) {
  const value = await getSystemSettingValue(key);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string" && value.trim()) {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }

  const envValue = process.env[key];
  if (!envValue) return fallback;
  return ["1", "true", "yes", "on"].includes(envValue.toLowerCase());
}

export async function getRuntimeSettingNumber(
  key: SettingKey,
  fallback: number,
  options?: { positive?: boolean; nonNegative?: boolean }
) {
  const isAllowedNumber = (candidate: number) => {
    if (!Number.isFinite(candidate)) return false;
    if (options?.positive) return candidate > 0;
    if (options?.nonNegative) return candidate >= 0;
    return true;
  };
  const value = await getSystemSettingValue(key);
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (isAllowedNumber(numericValue)) {
    return numericValue;
  }

  const envRawValue = process.env[key]?.trim();
  if (envRawValue) {
    const envValue = Number(envRawValue);
    if (isAllowedNumber(envValue)) {
      return envValue;
    }
  }

  return fallback;
}

export async function getRuntimeSettingSelect<T extends string>(
  key: SettingKey,
  allowed: readonly T[],
  fallback: T
) {
  const value = await getRuntimeSettingString(key);
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function getProcessSettingString(key: SettingKey) {
  return process.env[key]?.trim() || undefined;
}

export function getProcessSettingBoolean(key: SettingKey, fallback = false) {
  const value = process.env[key];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getProcessSettingNumber(key: SettingKey, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function coerceValue(definition: SettingDefinition, value: unknown) {
  if (definition.valueType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    }
    return Boolean(value);
  }

  if (definition.valueType === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${definition.label} 必须是有效数字`);
    }
    return numeric;
  }

  if (definition.valueType === "json") {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        throw new Error(`${definition.label} 必须是有效 JSON`);
      }
    }
    return value;
  }

  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  if (definition.valueType === "select") {
    const allowed = definition.options?.map((option) => option.value) ?? [];
    if (text && !allowed.includes(text)) {
      throw new Error(`${definition.label} 的取值无效`);
    }
  }
  return text;
}

function getProcessSettingValue(definition: SettingDefinition) {
  const envValue = process.env[definition.key]?.trim();
  if (!envValue) return undefined;
  return coerceValue(definition, envValue);
}

function getDefaultSettingValue(definition: SettingDefinition) {
  if (definition.secret) return undefined;
  if (definition.exampleValue !== undefined) return definition.exampleValue;
  if (definition.defaultValue !== undefined) return definition.defaultValue;
  return undefined;
}

export async function importSystemSettingsFromEnv(options?: {
  updatedBy?: string;
  overwrite?: boolean;
}) {
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting);

  const storedKeys = new Set(
    rows
      .filter((row) => normalizeStoredValue(row.value) !== undefined)
      .map((row) => row.key)
  );
  const now = new Date();
  const values = SYSTEM_SETTING_DEFINITIONS.flatMap((definition) => {
    if (!options?.overwrite && storedKeys.has(definition.key)) return [];

    const value = getProcessSettingValue(definition);
    if (value === undefined || value === "") return [];

    return [
      {
        key: definition.key,
        value,
        isSecret: "secret" in definition && Boolean(definition.secret),
        ...(options?.updatedBy ? { updatedBy: options.updatedBy } : {}),
        updatedAt: now,
      },
    ];
  });

  if (values.length === 0) return [] as SettingKey[];

  await db
    .insert(systemSetting)
    .values(values)
    .onConflictDoUpdate({
      target: systemSetting.key,
      set: {
        value: sql`excluded.value`,
        isSecret: sql`excluded.is_secret`,
        updatedBy: sql`excluded.updated_by`,
        updatedAt: now,
      },
    });

  clearSystemSettingsCache();
  return values.map((value) => value.key);
}

export async function initializeMissingSystemSettingsDefaults(options?: {
  updatedBy?: string;
}) {
  const now = new Date();
  await migrateLegacyModerationSettings(now, options?.updatedBy);

  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting);

  const storedKeys = new Set(
    rows
      .filter((row) => normalizeStoredValue(row.value) !== undefined)
      .map((row) => row.key)
  );
  const values = SYSTEM_SETTING_DEFINITIONS.flatMap((definition) => {
    if (storedKeys.has(definition.key)) return [];

    const value = getDefaultSettingValue(definition);
    if (value === undefined || value === "") return [];

    return [
      {
        key: definition.key,
        value,
        isSecret: false,
        ...(options?.updatedBy ? { updatedBy: options.updatedBy } : {}),
        updatedAt: now,
      },
    ];
  });

  if (values.length === 0) return [] as SettingKey[];

  await db
    .insert(systemSetting)
    .values(values)
    .onConflictDoNothing({
      target: systemSetting.key,
    });

  clearSystemSettingsCache();
  return values.map((value) => value.key);
}

async function migrateLegacyModerationSettings(now: Date, updatedBy?: string) {
  const legacyKeys = [
    "ALIYUN_MODERATION_PUBLIC_BASE_URL",
    "ALIYUN_MODERATION_BLOCK_RISK_LEVEL",
  ];
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting)
    .where(
      inArray(systemSetting.key, [
        "CONTENT_MODERATION_PUBLIC_BASE_URL",
        ...legacyKeys,
      ])
    );

  const stored = new Map(
    rows
      .map((row) => [row.key, normalizeStoredValue(row.value)] as const)
      .filter(([, value]) => value !== undefined)
  );
  const legacyPublicBaseUrl = stored.get("ALIYUN_MODERATION_PUBLIC_BASE_URL");
  const hasPublicBaseUrl = stored.has("CONTENT_MODERATION_PUBLIC_BASE_URL");

  await db.transaction(async (tx) => {
    if (!hasPublicBaseUrl && legacyPublicBaseUrl !== undefined) {
      await tx
        .insert(systemSetting)
        .values({
          key: "CONTENT_MODERATION_PUBLIC_BASE_URL",
          value: legacyPublicBaseUrl,
          isSecret: false,
          ...(updatedBy ? { updatedBy } : {}),
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: systemSetting.key,
        });
    }

    await tx
      .delete(systemSetting)
      .where(inArray(systemSetting.key, legacyKeys));
  });

  clearSystemSettingsCache();
}

export async function importMissingSystemSettingsFromEnv(updatedBy?: string) {
  return importSystemSettingsFromEnv(
    updatedBy === undefined ? undefined : { updatedBy }
  );
}

export async function setSystemSettings(
  entries: Array<{
    key: string;
    value: unknown;
    clear?: boolean;
  }>,
  updatedBy: string
) {
  const now = new Date();
  const changedKeys: SettingKey[] = [];

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      if (!isSettingKey(entry.key)) {
        throw new Error(`未知配置项: ${entry.key}`);
      }

      const definition = SETTING_DEFINITION_BY_KEY.get(entry.key);
      if (!definition) {
        throw new Error(`未知配置项: ${entry.key}`);
      }

      if (entry.clear) {
        await tx
          .delete(systemSetting)
          .where(eq(systemSetting.key, entry.key));
        changedKeys.push(entry.key);
        continue;
      }

      if (
        definition.secret &&
        typeof entry.value === "string" &&
        !entry.value.trim()
      ) {
        continue;
      }

      const value = coerceValue(definition, entry.value);
      if (value === "") {
        await tx
          .delete(systemSetting)
          .where(eq(systemSetting.key, entry.key));
      } else {
        await tx
          .insert(systemSetting)
          .values({
            key: entry.key,
            value,
            isSecret: Boolean(definition.secret),
            updatedBy,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: systemSetting.key,
            set: {
              value,
              isSecret: Boolean(definition.secret),
              updatedBy,
              updatedAt: now,
            },
          });
      }
      changedKeys.push(entry.key);
    }
  });

  clearSystemSettingsCache();
  return changedKeys;
}

export async function getAdminSystemSettingsSnapshot() {
  const keys = SYSTEM_SETTING_DEFINITIONS.map((definition) => definition.key);
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
      isSecret: systemSetting.isSecret,
      updatedAt: systemSetting.updatedAt,
    })
    .from(systemSetting)
    .where(inArray(systemSetting.key, keys));

  const stored = new Map(rows.map((row) => [row.key, row]));

  return SYSTEM_SETTING_DEFINITIONS.map((definition) => {
    const row = stored.get(definition.key);
    const envValue = process.env[definition.key];
    const hasStoredValue =
      row?.value !== undefined &&
      row.value !== null &&
      (typeof row.value !== "string" || row.value.trim().length > 0);
    const hasEnvValue = typeof envValue === "string" && envValue.trim().length > 0;
    const isSecret = "secret" in definition && Boolean(definition.secret);
    const displayValue = isSecret
      ? ""
      : hasStoredValue
        ? typeof row.value === "object"
          ? JSON.stringify(row.value, null, 2)
          : String(row.value)
        : hasEnvValue
          ? envValue.trim()
          : "";

    return {
      ...definition,
      value: displayValue,
      configured: hasStoredValue || hasEnvValue,
      stored: hasStoredValue,
      fromEnv: !hasStoredValue && hasEnvValue,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  });
}
