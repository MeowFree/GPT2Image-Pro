/**
 * Next.js Instrumentation Hook
 *
 * 用于在服务器启动时执行初始化逻辑
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 服务端初始化
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapSystemSettingsEnv } = await import(
      "@repo/shared/system-settings/bootstrap"
    );
    await bootstrapSystemSettingsEnv();
    const { bootstrapSelfUseSuperAdmin } = await import(
      "@repo/shared/auth/bootstrap-super-admin"
    );
    await bootstrapSelfUseSuperAdmin();
    const { startInternalJobScheduler } = await import(
      "./server/internal-job-scheduler"
    );
    await startInternalJobScheduler();
    // Sentry 服务端初始化
    await import("../sentry.server.config");
  }

  // Edge Runtime 初始化
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
