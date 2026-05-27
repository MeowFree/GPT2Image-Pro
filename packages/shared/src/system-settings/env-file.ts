import { promises as fs } from "node:fs";
import path from "node:path";

import { db } from "@repo/database";
import { systemSetting } from "@repo/database/schema";

import { SETTING_DEFINITION_BY_KEY, type SettingKey } from "./definitions";

const DEFAULT_ENV_FILE_PATHS = [
  "/root/GPT2Image-Pro/apps/web/.env.local",
  "/home/user1/GPT2Image-Pro/apps/web/.env.local",
];

const MANAGED_INTERNAL_ENV_KEYS = new Set<string>(["SUB2API_AUTO_SYNC_TASKS"]);

export function shouldSyncSettingToEnvFile(key: string) {
  return (
    SETTING_DEFINITION_BY_KEY.has(key as SettingKey) ||
    MANAGED_INTERNAL_ENV_KEYS.has(key)
  );
}

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

function serializeEnvLine(key: string, value: unknown) {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return `${key}=${quoteEnvValue(text)}`;
}

function shouldWriteEnvFile(filePath: string) {
  return filePath.startsWith("/root/") || filePath.startsWith("/home/");
}

export async function syncSystemSettingsToEnvFiles() {
  const rows = await db
    .select({
      key: systemSetting.key,
      value: systemSetting.value,
    })
    .from(systemSetting);

  if (rows.length === 0) {
    return { files: [] as string[] };
  }

  const managed = [
    "# BEGIN GPT2IMAGE ADMIN SETTINGS",
    ...rows
      .filter((row) => row.value !== null && row.value !== undefined)
      .filter((row) => shouldSyncSettingToEnvFile(row.key))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => serializeEnvLine(row.key, row.value)),
    "# END GPT2IMAGE ADMIN SETTINGS",
  ].join("\n");

  const writtenFiles: string[] = [];
  for (const filePath of DEFAULT_ENV_FILE_PATHS) {
    if (!shouldWriteEnvFile(filePath)) continue;
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      let current = "";
      try {
        current = await fs.readFile(filePath, "utf8");
      } catch {
        current = "";
      }

      const next = current.includes("# BEGIN GPT2IMAGE ADMIN SETTINGS")
        ? current.replace(
            /# BEGIN GPT2IMAGE ADMIN SETTINGS[\s\S]*?# END GPT2IMAGE ADMIN SETTINGS/g,
            managed
          )
        : `${current.trimEnd()}\n\n${managed}\n`;

      await fs.writeFile(filePath, next.trimStart(), { mode: 0o600 });
      writtenFiles.push(filePath);
    } catch {
      // Best effort. The database remains the source of truth.
    }
  }

  return { files: writtenFiles };
}
