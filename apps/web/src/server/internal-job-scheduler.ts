import { db } from "@repo/database";
import { sql } from "drizzle-orm";

import {
  getRuntimeSettingBoolean,
  getRuntimeSettingNumber,
} from "@repo/shared/system-settings";

import {
  runCreditsExpireJob,
  runImageMaintenanceJob,
  runSub2ApiSyncJob,
  runWebAccountsRefreshJob,
} from "./scheduled-jobs";

type InternalJob = {
  name: string;
  lockKey: number;
  intervalSettingKey:
    | "INTERNAL_JOB_IMAGES_MAINTENANCE_INTERVAL_MINUTES"
    | "INTERNAL_JOB_CREDITS_EXPIRE_INTERVAL_MINUTES"
    | "INTERNAL_JOB_WEB_ACCOUNTS_REFRESH_INTERVAL_MINUTES"
    | "INTERNAL_JOB_SUB2API_SYNC_INTERVAL_MINUTES";
  defaultIntervalMinutes: number;
  initialDelayMs: number;
  run: () => Promise<unknown>;
};

type SchedulerState = {
  started: boolean;
};

type SchedulerGlobal = typeof globalThis & {
  __gpt2imageInternalJobScheduler?: SchedulerState;
};

const LOCK_NAMESPACE = 20_260_527;
const MINUTE_MS = 60 * 1000;
const schedulerGlobal = globalThis as SchedulerGlobal;

const jobs: InternalJob[] = [
  {
    name: "images-maintenance",
    lockKey: 1,
    intervalSettingKey: "INTERNAL_JOB_IMAGES_MAINTENANCE_INTERVAL_MINUTES",
    defaultIntervalMinutes: 5,
    initialDelayMs: 30_000,
    run: runImageMaintenanceJob,
  },
  {
    name: "credits-expire",
    lockKey: 2,
    intervalSettingKey: "INTERNAL_JOB_CREDITS_EXPIRE_INTERVAL_MINUTES",
    defaultIntervalMinutes: 24 * 60,
    initialDelayMs: 60_000,
    run: runCreditsExpireJob,
  },
  {
    name: "web-accounts-refresh",
    lockKey: 3,
    intervalSettingKey: "INTERNAL_JOB_WEB_ACCOUNTS_REFRESH_INTERVAL_MINUTES",
    defaultIntervalMinutes: 10,
    initialDelayMs: 90_000,
    run: runWebAccountsRefreshJob,
  },
  {
    name: "sub2api-sync",
    lockKey: 4,
    intervalSettingKey: "INTERNAL_JOB_SUB2API_SYNC_INTERVAL_MINUTES",
    defaultIntervalMinutes: 10,
    initialDelayMs: 120_000,
    run: () => runSub2ApiSyncJob(),
  },
];

function getSchedulerState() {
  if (!schedulerGlobal.__gpt2imageInternalJobScheduler) {
    schedulerGlobal.__gpt2imageInternalJobScheduler = {
      started: false,
    };
  }
  return schedulerGlobal.__gpt2imageInternalJobScheduler;
}

function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) {
    return result[0] as Record<string, unknown> | undefined;
  }
  const rows = (result as { rows?: unknown[] } | undefined)?.rows;
  return Array.isArray(rows)
    ? (rows[0] as Record<string, unknown> | undefined)
    : undefined;
}

function readBooleanResult(result: unknown, key: string) {
  return firstRow(result)?.[key] === true;
}

async function withJobLock<T>(job: InternalJob, run: () => Promise<T>) {
  return await db.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`select pg_try_advisory_xact_lock(${LOCK_NAMESPACE}, ${job.lockKey}) as locked`
    );
    if (!readBooleanResult(lockResult, "locked")) {
      return { locked: false as const };
    }

    return {
      locked: true as const,
      result: await run(),
    };
  });
}

async function getIntervalMs(job: InternalJob) {
  const minutes = await getRuntimeSettingNumber(
    job.intervalSettingKey,
    job.defaultIntervalMinutes,
    { positive: true }
  );
  return Math.max(1, Math.trunc(minutes)) * MINUTE_MS;
}

async function runJob(job: InternalJob) {
  const enabled = await getRuntimeSettingBoolean(
    "INTERNAL_JOB_SCHEDULER_ENABLED",
    true
  );
  if (!enabled) return;

  const startedAt = Date.now();
  try {
    const result = await withJobLock(job, job.run);
    if (!result.locked) return;
    console.info(
      `[internal-jobs] ${job.name} completed in ${Date.now() - startedAt}ms`
    );
  } catch (error) {
    console.warn(`[internal-jobs] ${job.name} failed`, error);
  }
}

async function scheduleJob(job: InternalJob) {
  let running = false;

  const scheduleNext = (delayMs: number) => {
    const timer = setTimeout(() => {
      void tick();
    }, delayMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (running) {
      scheduleNext(await getIntervalMs(job));
      return;
    }

    running = true;
    try {
      await runJob(job);
    } finally {
      running = false;
    }

    try {
      scheduleNext(await getIntervalMs(job));
    } catch {
      scheduleNext(job.defaultIntervalMinutes * MINUTE_MS);
    }
  };

  scheduleNext(job.initialDelayMs);
}

export async function startInternalJobScheduler() {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const state = getSchedulerState();
  if (state.started) return;

  try {
    const enabled = await getRuntimeSettingBoolean(
      "INTERNAL_JOB_SCHEDULER_ENABLED",
      true
    );
    if (!enabled) return;

    state.started = true;
    await Promise.all(jobs.map((job) => scheduleJob(job)));
    console.info("[internal-jobs] scheduler started");
  } catch (error) {
    state.started = false;
    console.warn("[internal-jobs] scheduler failed to start", error);
  }
}
