/**
 * 存储对象读取路由的 DB-free 单测
 *
 * 覆盖：桶白名单、路径穿越拒绝、正常读取、404/502 错误映���、
 * 签名验证（generations 桶需要 sig+exp，avatars 桶公开访问）。
 */

import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// 模拟存储 provider，使该路由测试保持 DB-free（不触达 @repo/database / runtime settings）。
const getObject = vi.fn();
vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: vi.fn(async () => ({ getObject })),
}));

// 静音日志，避免 502 路径打印噪声，同时验证基础设施故障会被记录。
const logError = vi.hoisted(() => vi.fn());
vi.mock("@repo/shared/logger", () => ({ logError }));

// 第一方会话回退鉴权的依赖:getCurrentUser(会话)与 db(按 storage_key 查归属)。
// 保持 DB-free:getCurrentUser/db 均被 mock;正常签名校验通过的用例不会触达它们。
const { getCurrentUser, dbState } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  dbState: { rows: [] as Array<{ userId: string | null }> },
}));
vi.mock("@repo/shared/auth/server", () => ({ getCurrentUser }));
vi.mock("@repo/database", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => dbState.rows }),
      }),
    }),
  },
}));
vi.mock("@repo/database/schema", () => ({
  generation: { userId: "userId", storageKey: "storageKey" },
}));

import { generateSignedImageParams } from "@repo/shared/storage/signed-url";
import { GET } from "./route";

const TEST_SECRET = "test-secret-for-storage-route-tests";

// 构造 Next.js App Router 动态路由约定的 params Promise。
function makeParams(bucket: string, key: string[]) {
  return { params: Promise.resolve({ bucket, key }) };
}

/**
 * 构造带 nextUrl.searchParams 的 NextRequest 模拟对象。
 * avatars 桶不需要签名；generations 桶需要 sig+exp。
 */
function makeRequest(
  searchParams?: Record<string, string>
): NextRequest {
  const params = new URLSearchParams(searchParams);
  return {
    nextUrl: {
      searchParams: params,
    },
    // 读取路由会把 request.signal 透传给 getObject(取消传播),并在缩略图路径读取
    // signal.aborted;提供一个未中止的 AbortSignal 占位,避免读取 undefined.aborted。
    signal: { aborted: false } as AbortSignal,
  } as unknown as NextRequest;
}

/**
 * 构造带有效签名参数的请求。
 */
function makeSignedRequest(bucket: string, key: string): NextRequest {
  const { sig, exp } = generateSignedImageParams(bucket, key);
  return makeRequest({ sig, exp: String(exp) });
}

describe("GET /api/storage/[bucket]/[...key]", () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
    getObject.mockReset();
    logError.mockReset();
    // 默认:无会话(签名失败即 403),归属查询返回空。各用例按需覆盖。
    getCurrentUser.mockReset();
    getCurrentUser.mockResolvedValue(null);
    dbState.rows = [];
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalSecret;
    }
  });

  it("拒绝非白名单桶（403 且不访问对象）", async () => {
    const res = await GET(makeRequest(), makeParams("secrets", ["a.png"]));
    expect(res.status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("拒绝路径穿越的 key（400）", async () => {
    const res = await GET(
      makeSignedRequest("generations", "../etc/passwd"),
      makeParams("generations", ["..", "etc", "passwd"])
    );
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("拒绝含反斜杠的 key（400）", async () => {
    const res = await GET(
      makeSignedRequest("generations", "a\\b.png"),
      makeParams("generations", ["a\\b.png"])
    );
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("拒绝以斜杠开头的 key（400）", async () => {
    const res = await GET(
      makeSignedRequest("generations", "/abs.png"),
      makeParams("generations", ["", "abs.png"])
    );
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("拒绝空 key（400）", async () => {
    const res = await GET(
      makeSignedRequest("generations", ""),
      makeParams("generations", [""])
    );
    expect(res.status).toBe(400);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("generations 桶缺少签名返回 403", async () => {
    const res = await GET(
      makeRequest(),
      makeParams("generations", ["user-123", "abc.png"])
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Missing signature");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getObject).not.toHaveBeenCalled();
  });

  it("generations 桶签名过期返回 403", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const { sig } = generateSignedImageParams(
      "generations",
      "user-123/abc.png"
    );
    const res = await GET(
      makeRequest({ sig, exp: String(pastExp) }),
      makeParams("generations", ["user-123", "abc.png"])
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Signature expired");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getObject).not.toHaveBeenCalled();
  });

  it("generations 桶签名无效返回 403", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const res = await GET(
      makeRequest({ sig: "a".repeat(64), exp: String(futureExp) }),
      makeParams("generations", ["user-123", "abc.png"])
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Invalid signature");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getObject).not.toHaveBeenCalled();
  });

  it("generations 桶有效签名返回图片字节、正确 content-type 与长缓存", async () => {
    getObject.mockResolvedValue(Buffer.from("png-bytes"));
    const res = await GET(
      makeSignedRequest("generations", "user-123/abc.png"),
      makeParams("generations", ["user-123", "abc.png"])
    );
    expect(res.status).toBe(200);
    expect(getObject).toHaveBeenCalledWith("user-123/abc.png", "generations", {
      signal: expect.anything(),
    });
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(res.headers.get("Content-Length")).toBe("9");
    // 图片白名单扩展不应被强制下载。
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("png-bytes");
  });

  it("签名缺失但第一方会话且归属本人 → 放行(回退鉴权,200)", async () => {
    // 浏览器同源请求带 cookie:即便没有/过期签名,拥有该图的登录用户也能读自己的图。
    getCurrentUser.mockResolvedValue({ id: "user-123" });
    dbState.rows = [{ userId: "user-123" }];
    getObject.mockResolvedValue(Buffer.from("png-bytes"));
    const res = await GET(
      makeRequest(),
      makeParams("generations", ["user-123", "abc.png"])
    );
    expect(res.status).toBe(200);
    expect(getObject).toHaveBeenCalledWith("user-123/abc.png", "generations", {
      signal: expect.anything(),
    });
  });

  it("签名缺失且会话用户非归属人 → 403(杜绝越权 IDOR)", async () => {
    getCurrentUser.mockResolvedValue({ id: "intruder" });
    dbState.rows = [{ userId: "owner-1" }];
    const res = await GET(
      makeRequest(),
      makeParams("generations", ["owner-1", "abc.png"])
    );
    expect(res.status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("avatars 桶无需签名即可公开访问", async () => {
    getObject.mockResolvedValue(Buffer.from("avatar-bytes"));
    const res = await GET(
      makeRequest(),
      makeParams("avatars", ["user-9", "profile.jpg"])
    );
    expect(res.status).toBe(200);
    expect(getObject).toHaveBeenCalledWith("user-9/profile.jpg", "avatars", {
      signal: expect.anything(),
    });
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("未知扩展回退 octet-stream 并以附件下载（防内容嗅探/存储型 XSS）", async () => {
    getObject.mockResolvedValue(Buffer.from("<svg/>"));
    const res = await GET(
      makeRequest(),
      makeParams("avatars", ["user-9", "evil.svg"])
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("对象不存在（ENOENT）映射为 404 且不记录基础设施错误", async () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    getObject.mockRejectedValue(enoent);
    const res = await GET(
      makeSignedRequest("generations", "user-1/missing.png"),
      makeParams("generations", ["user-1", "missing.png"])
    );
    expect(res.status).toBe(404);
    expect(logError).not.toHaveBeenCalled();
  });

  it("S3 缺键（NoSuchKey）映射为 404", async () => {
    const noSuchKey = Object.assign(new Error("not found"), {
      name: "NoSuchKey",
    });
    getObject.mockRejectedValue(noSuchKey);
    const res = await GET(
      makeSignedRequest("generations", "user-1/missing.png"),
      makeParams("generations", ["user-1", "missing.png"])
    );
    expect(res.status).toBe(404);
    expect(logError).not.toHaveBeenCalled();
  });

  it("缩略图宽度走路径段 /w<width>/:验签前剥离宽度段,getObject 用真实 key", async () => {
    // 签名只覆盖真实 key(不含 w128 段);URL 路径首段是 w128。
    // 验证:剥离宽度段后用真实 key 验签通过(非 403)、getObject 收到真实 key。
    // 注:sharp 对非图片字节缩放会失败并回退返回原图(本测试不关心缩放结果)。
    getObject.mockResolvedValue(Buffer.from("png-bytes"));
    const { sig, exp } = generateSignedImageParams(
      "generations",
      "user-123/abc.png"
    );
    const res = await GET(
      makeRequest({ sig, exp: String(exp) }),
      makeParams("generations", ["w128", "user-123", "abc.png"])
    );
    expect(res.status).toBe(200);
    expect(getObject).toHaveBeenCalledWith("user-123/abc.png", "generations", {
      signal: expect.anything(),
    });
  });

  it("路径宽度段用错误 key 的签名仍 403(宽度段不能绕过鉴权)", async () => {
    // 用 "其它/key.png" 的签名去访问 "user-123/abc.png",即便带 w128 段也应 403。
    const { sig, exp } = generateSignedImageParams("generations", "other/key.png");
    const res = await GET(
      makeRequest({ sig, exp: String(exp) }),
      makeParams("generations", ["w128", "user-123", "abc.png"])
    );
    expect(res.status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("基础设施故障映射为 502 并记日志（不静默吞成 404）", async () => {
    getObject.mockRejectedValue(new Error("存储配置缺失"));
    const res = await GET(
      makeSignedRequest("generations", "user-1/abc.png"),
      makeParams("generations", ["user-1", "abc.png"])
    );
    expect(res.status).toBe(502);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
