import crypto from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { withApiLogging } from "@repo/shared/api-logger";
import { getRuntimeSettingString } from "@repo/shared/system-settings";

import { runSub2ApiSyncJob } from "@/server/scheduled-jobs";

async function validateCronSecret(authHeader: string | null) {
  if (!authHeader) return false;
  const cronSecret = await getRuntimeSettingString("CRON_SECRET");
  if (!cronSecret) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (!token) return false;
  const tokenHash = crypto.createHash("sha256").update(Buffer.from(token)).digest();
  const secretHash = crypto
    .createHash("sha256")
    .update(Buffer.from(cronSecret))
    .digest();
  if (tokenHash.length !== secretHash.length) return false;
  return crypto.timingSafeEqual(tokenHash, secretHash);
}

export const POST = withApiLogging(async (request: Request) => {
  const headersList = await headers();
  if (!(await validateCronSecret(headersList.get("authorization")))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = ["1", "true", "yes"].includes(
    (url.searchParams.get("force") || "").toLowerCase()
  );
  const result = await runSub2ApiSyncJob({ force });

  return NextResponse.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
});

export const GET = withApiLogging(async () =>
  NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/image-backend/sub2api/sync",
    method: "POST",
    description: "Sync Sub2API current access tokens into the image backend pool",
    schedule:
      "Call from crontab regularly; actual interval is controlled by SUB2API_AUTO_SYNC_INTERVAL_MINUTES.",
    authentication: "Bearer token required (CRON_SECRET)",
  })
);
