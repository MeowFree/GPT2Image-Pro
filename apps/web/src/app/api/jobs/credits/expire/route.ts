import crypto from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { withApiLogging } from "@repo/shared/api-logger";
import { logError, logWarn } from "@repo/shared/logger";

import { runCreditsExpireJob } from "@/server/scheduled-jobs";

/**
 * 积分过期处理 Cron Job API
 *
 * 定期处理过期的积分批次，需通过 Bearer Token（CRON_SECRET）鉴权。
 *
 * 触发方式：生产以内置定时调度器为主（INTERNAL_JOB_SCHEDULER_ENABLED + PG
 * advisory lock）；外部 cron 以携带 Bearer CRON_SECRET 调用 POST 作为回退。
 * 部署为 Docker Compose + Nginx，不使用 Vercel Cron。
 */

/**
 * 验证 Cron Job 请求的 Bearer Token
 */
function validateCronSecret(authHeader: string | null): boolean {
  if (!authHeader) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logWarn("CRON_SECRET environment variable is not set");
    return false;
  }

  // 支持 Bearer Token 格式
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
  // 长度不一致时 timingSafeEqual 会抛错，先行短路保持与其它 cron 路由一致
  if (tokenHash.length !== secretHash.length) return false;
  return crypto.timingSafeEqual(tokenHash, secretHash);
}

/**
 * POST /api/jobs/credits/expire
 *
 * 处理所有过期的积分批次
 */
export const POST = withApiLogging(async () => {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  // 验证身份
  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runCreditsExpireJob());
  } catch (error) {
    // 仅记日志，不向调用方回显内部异常 message（可能含 DB/约束细节）
    logError(error, { job: "credits-expire" });

    return NextResponse.json(
      {
        success: false,
        error: "Failed to process expired batches",
      },
      { status: 500 }
    );
  }
});

/**
 * GET /api/jobs/credits/expire
 *
 * 健康检查端点，用于验证 Cron Job 配置是否正确
 */
export const GET = withApiLogging(async () => {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/credits/expire",
    method: "POST",
    description: "Process expired credit batches",
    authentication: "Bearer token required (process env CRON_SECRET)",
  });
});
