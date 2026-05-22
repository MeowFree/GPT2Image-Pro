"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "@repo/database";
import { userApiConfig } from "@repo/database/schema";
import { protectedAction } from "@repo/shared/safe-action";
import { canUseCustomApi } from "@repo/shared/config/subscription-plan";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";

/**
 * 检查 URL 是否指向私有/内部网络地址
 * 用于防止 SSRF（服务端请求伪造）攻击
 */
function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // NOTE: DNS rebinding attacks remain a limitation — a domain can resolve to
    // a public IP at validation time and then to a private IP on the actual
    // request. A true fix requires performing DNS resolution at validation time
    // and pinning the resolved IP for the subsequent request.

    // Reject URLs with embedded credentials (can bypass hostname checks in some parsers)
    if (url.username || url.password) return true;

    if (url.protocol !== "https:") return true;
    if (hostname === "localhost" || hostname === "::1") return true;
    // IPv6 loopback with brackets (as parsed by URL constructor)
    if (hostname === "[::1]") return true;
    if (hostname === "metadata.google.internal") return true;
    if (hostname.endsWith(".internal")) return true;

    // Reject IPv6 shorthand hex-encoded private/loopback ranges
    // e.g., ::ffff:7f00:1 (127.0.0.1), ::ffff:a00:0 (10.0.0.0), ::ffff:c0a8:0 (192.168.0.0)
    const ipv6HexMatch = hostname.replace(/^\[|\]$/g, "").match(
      /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
    );
    if (ipv6HexMatch?.[1] && ipv6HexMatch[2]) {
      const high = Number.parseInt(ipv6HexMatch[1], 16);
      const a = (high >> 8) & 0xff;
      const b = high & 0xff;
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 127) return true; // 127.0.0.0/8
      if (a === 169 && b === 254) return true; // 169.254.0.0/16
      if (a === 0) return true; // 0.0.0.0/8
    }

    // Check IPv6-mapped IPv4 addresses (e.g., ::ffff:127.0.0.1)
    const ipv6MappedMatch = hostname.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv6MappedMatch) {
      const a = Number(ipv6MappedMatch[1]);
      const b = Number(ipv6MappedMatch[2]);
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }

    // 检查私有 IP 地址范围
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const a = Number(ipMatch[1]);
      const b = Number(ipMatch[2]);

      // Reject octal IP notation (e.g., 0177.0.0.1 = 127.0.0.1)
      const octets = hostname.split(".");
      if (octets.some((o) => o.length > 1 && o.startsWith("0"))) return true;

      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }

    return false;
  } catch {
    return true;
  }
}

const optionalTrimmedString = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const apiConfigSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url("Use a valid HTTPS API base URL")
    .refine((url) => !isPrivateUrl(url), "Use a public HTTPS API base URL"),
  apiKey: z.string().trim().min(1, "API key is required"),
  model: optionalTrimmedString,
  useStream: z.boolean().optional(),
});

const withApiConfigAction = (name: string) =>
  protectedAction.metadata({ action: `settings.apiConfig.${name}` });

async function ensureCustomApiAllowed(userId: string) {
  const plan = await getUserPlan(userId);
  if (!canUseCustomApi(plan.plan)) {
    throw new Error("Custom API configuration requires Starter plan or higher.");
  }
}

export const getApiConfig = withApiConfigAction("get").action(
  async ({ ctx }) => {
    const config = await db
      .select()
      .from(userApiConfig)
      .where(eq(userApiConfig.userId, ctx.userId))
      .limit(1);
    return config[0] || null;
  }
);

export const saveApiConfig = withApiConfigAction("save")
  .schema(apiConfigSchema)
  .action(async ({ parsedInput, ctx }) => {
    await ensureCustomApiAllowed(ctx.userId);

    const existing = await db
      .select()
      .from(userApiConfig)
      .where(eq(userApiConfig.userId, ctx.userId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(userApiConfig)
        .set({
          baseUrl: parsedInput.baseUrl,
          apiKey: parsedInput.apiKey,
          model: parsedInput.model || null,
          useStream: parsedInput.useStream ?? false,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(userApiConfig.userId, ctx.userId));
    } else {
      await db.insert(userApiConfig).values({
        id: nanoid(),
        userId: ctx.userId,
        baseUrl: parsedInput.baseUrl,
        apiKey: parsedInput.apiKey,
        model: parsedInput.model || null,
        useStream: parsedInput.useStream ?? false,
        isActive: true,
      });
    }

    return { success: true };
  });

export const deleteApiConfig = withApiConfigAction("delete").action(
  async ({ ctx }) => {
    await db.delete(userApiConfig).where(eq(userApiConfig.userId, ctx.userId));
    return { success: true };
  }
);

export const toggleApiConfig = withApiConfigAction("toggle")
  .schema(z.object({ isActive: z.boolean() }))
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.isActive) {
      await ensureCustomApiAllowed(ctx.userId);
    }

    await db
      .update(userApiConfig)
      .set({
        isActive: parsedInput.isActive,
        updatedAt: new Date(),
      })
      .where(eq(userApiConfig.userId, ctx.userId));
    return { success: true };
  });
