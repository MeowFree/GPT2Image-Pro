import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { withApiLogging } from "@repo/shared/api-logger";
import { validateCronSecret } from "@repo/shared/jobs/cron-auth";
import { runSub2ApiSyncJob } from "@repo/image-generation/jobs-scheduled";

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
      "Call periodically; configured Sub2API auto-sync tasks decide their own run intervals.",
    authentication: "Bearer token required (process env CRON_SECRET)",
  })
);
