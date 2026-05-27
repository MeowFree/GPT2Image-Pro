import crypto from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { withApiLogging } from "@repo/shared/api-logger";
import { runImageMaintenanceJob } from "@/server/scheduled-jobs";

function validateCronSecret(authHeader: string | null): boolean {
  if (!authHeader) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.warn("CRON_SECRET environment variable is not set");
    return false;
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (!token) return false;

  const tokenHash = crypto
    .createHash("sha256")
    .update(Buffer.from(token))
    .digest();
  const secretHash = crypto
    .createHash("sha256")
    .update(Buffer.from(cronSecret))
    .digest();

  if (tokenHash.length !== secretHash.length) return false;
  return crypto.timingSafeEqual(tokenHash, secretHash);
}

export const POST = withApiLogging(async () => {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await runImageMaintenanceJob());
});

export const GET = withApiLogging(async () => {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/images/expire-pending",
    method: "POST",
    description:
      "Expire pending image generations older than 20 minutes and destroy completed image files when configured",
    authentication: "Bearer token required (CRON_SECRET)",
  });
});
