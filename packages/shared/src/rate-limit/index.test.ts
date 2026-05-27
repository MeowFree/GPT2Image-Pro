import { describe, expect, it, vi } from "vitest";

const RATE_LIMIT_ENV_KEYS = [
  "RATE_LIMIT_GLOBAL_REQUESTS_PER_MINUTE",
  "RATE_LIMIT_AUTH_REQUESTS_PER_MINUTE",
  "RATE_LIMIT_AI_REQUESTS_PER_MINUTE",
  "RATE_LIMIT_PAYMENT_REQUESTS_PER_MINUTE",
  "RATE_LIMIT_UPLOAD_REQUESTS_PER_MINUTE",
  "RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE",
] as const;

async function importFreshRateLimitConfig() {
  vi.resetModules();
  const module = await import("./index");
  return module.RateLimitConfig;
}

describe("rate limit config", () => {
  it("uses default request-per-minute thresholds", async () => {
    for (const key of RATE_LIMIT_ENV_KEYS) {
      delete process.env[key];
    }

    const config = await importFreshRateLimitConfig();

    expect(config.global.requests).toBe(100);
    expect(config.auth.requests).toBe(5);
    expect(config.ai.requests).toBe(20);
    expect(config.payment.requests).toBe(10);
    expect(config.upload.requests).toBe(30);
    expect(config.strict.requests).toBe(3);
  });

  it("uses positive integer thresholds from env", async () => {
    process.env.RATE_LIMIT_GLOBAL_REQUESTS_PER_MINUTE = "120";
    process.env.RATE_LIMIT_AUTH_REQUESTS_PER_MINUTE = "8";
    process.env.RATE_LIMIT_AI_REQUESTS_PER_MINUTE = "45";
    process.env.RATE_LIMIT_PAYMENT_REQUESTS_PER_MINUTE = "12";
    process.env.RATE_LIMIT_UPLOAD_REQUESTS_PER_MINUTE = "60";
    process.env.RATE_LIMIT_STRICT_REQUESTS_PER_MINUTE = "4";

    const config = await importFreshRateLimitConfig();

    expect(config.global.requests).toBe(120);
    expect(config.auth.requests).toBe(8);
    expect(config.ai.requests).toBe(45);
    expect(config.payment.requests).toBe(12);
    expect(config.upload.requests).toBe(60);
    expect(config.strict.requests).toBe(4);
  });

  it("falls back for invalid thresholds", async () => {
    process.env.RATE_LIMIT_AI_REQUESTS_PER_MINUTE = "0";
    process.env.RATE_LIMIT_UPLOAD_REQUESTS_PER_MINUTE = "abc";

    const config = await importFreshRateLimitConfig();

    expect(config.ai.requests).toBe(20);
    expect(config.upload.requests).toBe(30);
  });
});
