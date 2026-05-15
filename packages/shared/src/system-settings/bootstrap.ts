import { db } from "@repo/database";
import { systemSetting } from "@repo/database/schema";
import { importMissingSystemSettingsFromEnv } from ".";

let bootstrapped = false;

export async function bootstrapSystemSettingsEnv() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    await importMissingSystemSettingsFromEnv();

    const rows = await db
      .select({
        key: systemSetting.key,
        value: systemSetting.value,
      })
      .from(systemSetting);

    for (const row of rows) {
      if (row.value === null || row.value === undefined) continue;
      const value =
        typeof row.value === "string" ? row.value.trim() : String(row.value);
      if (value) {
        process.env[row.key] = value;
      }
    }
  } catch {
    // Auth and instrumentation modules must not fail import just because the
    // settings table is not migrated yet. Request-time settings still use env.
  }
}
