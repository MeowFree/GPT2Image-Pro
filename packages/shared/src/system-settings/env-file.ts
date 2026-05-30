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

// 托管块的哨兵标记。BEGIN..END 之间的内容由本模块独占管理，
// 下次同步会被整块替换，因此哨兵字符串绝不能出现在任何托管值里，
// 否则朴素的 BEGIN..END 提取会提前判定块结束并截断 .env.local（见 S-M9）。
const MANAGED_BLOCK_BEGIN = "# BEGIN GPT2IMAGE ADMIN SETTINGS";
const MANAGED_BLOCK_END = "# END GPT2IMAGE ADMIN SETTINGS";

const MANAGED_BLOCK_REGEX = new RegExp(
  `${MANAGED_BLOCK_BEGIN}[\\s\\S]*?${MANAGED_BLOCK_END}`,
  "g"
);

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

// 序列化后的行若含有任一哨兵子串（即便经 JSON.stringify 转义换行，
// 哨兵仍会以纯文本出现在引号内的同一物理行），就会污染托管块边界。
// 这类值必须排除在 env 镜像之外，DB 仍是真相来源。
function containsManagedBlockSentinel(line: string) {
  return line.includes(MANAGED_BLOCK_BEGIN) || line.includes(MANAGED_BLOCK_END);
}

/**
 * 由托管设置行构建 BEGIN..END 托管块文本（纯函数，DB-free 可测）。
 * - 仅保留应同步的 key、去除空值、按 key 稳定排序。
 * - 跳过序列化后含哨兵子串的行，避免破坏块边界。
 */
export function buildManagedEnvBlock(
  rows: Array<{ key: string; value: unknown }>
) {
  const lines = rows
    .filter((row) => row.value !== null && row.value !== undefined)
    .filter((row) => shouldSyncSettingToEnvFile(row.key))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((row) => serializeEnvLine(row.key, row.value))
    .filter((line) => !containsManagedBlockSentinel(line));

  return [MANAGED_BLOCK_BEGIN, ...lines, MANAGED_BLOCK_END].join("\n");
}

/**
 * 把托管块写回 .env.local 文本（纯函数，DB-free 可测）。
 * - 已存在托管块时整块替换；replacer 用函数形式，避免 managed 中的
 *   $$、$&、$`、$'、$1 等被 String.replace 当成特殊替换序列损坏（见 M-M25）。
 * - 不存在时追加到文件末尾。
 */
export function applyManagedEnvBlock(current: string, managed: string) {
  return current.includes(MANAGED_BLOCK_BEGIN)
    ? current.replace(MANAGED_BLOCK_REGEX, () => managed)
    : `${current.trimEnd()}\n\n${managed}\n`;
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

  const managed = buildManagedEnvBlock(rows);

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

      const next = applyManagedEnvBlock(current, managed);

      await fs.writeFile(filePath, next.trimStart(), { mode: 0o600 });
      writtenFiles.push(filePath);
    } catch {
      // Best effort. The database remains the source of truth.
    }
  }

  return { files: writtenFiles };
}
