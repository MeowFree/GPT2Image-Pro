/**
 * 上游 API 测活探针 `probeUpstreamApi` 的 DB-free 单测。
 *
 * 通过 mock `../security/dns-pin` 的 `fetchWithDnsPin`，覆盖正常（2xx）、
 * 鉴权失败（401/403）、其他 HTTP 错误、SSRF 阻断、网络异常与非法 URL，
 * 并校验请求构造（/models 路径、Bearer 头）与时延/模型数解析。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SsrfBlockedError } from "../security/dns-pin";
import { probeUpstreamApi } from "./probe";

vi.mock("../security/dns-pin", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../security/dns-pin")>();
  return { ...actual, fetchWithDnsPin: vi.fn() };
});

const { fetchWithDnsPin } = await import("../security/dns-pin");
const mockFetch = vi.mocked(fetchWithDnsPin);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeUpstreamApi", () => {
  it("2xx 且含模型列表时判定为 ok 并统计模型数", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), {
        status: 200,
      })
    );

    const result = await probeUpstreamApi({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.httpStatus).toBe(200);
    expect(result.modelCount).toBe(2);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("向 /models 发起带 Bearer 的 GET，并规整 baseUrl 末尾斜杠", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    await probeUpstreamApi({
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-secret",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.lastCall ?? [];
    expect(url).toBe("https://api.example.com/v1/models");
    expect(init?.method).toBe("GET");
    expect(init?.headers?.Authorization).toBe("Bearer sk-secret");
  });

  it("2xx 但响应体非 JSON 时仍判定为 ok，modelCount 缺省", async () => {
    mockFetch.mockResolvedValue(new Response("not-json", { status: 202 }));

    const result = await probeUpstreamApi({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.modelCount).toBeUndefined();
  });

  it.each([401, 403])("HTTP %d 判定为 auth_failed", async (status) => {
    mockFetch.mockResolvedValue(new Response("", { status }));

    const result = await probeUpstreamApi({
      baseUrl: "https://api.example.com/v1",
      apiKey: "bad-key",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("auth_failed");
    expect(result.httpStatus).toBe(status);
  });

  it.each([404, 429, 500])(
    "其他非 2xx（HTTP %d）判定为 http_error",
    async (status) => {
      mockFetch.mockResolvedValue(new Response("", { status }));

      const result = await probeUpstreamApi({
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-test",
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("http_error");
      expect(result.httpStatus).toBe(status);
    }
  );

  it("SSRF 阻断判定为 unreachable", async () => {
    mockFetch.mockRejectedValue(new SsrfBlockedError("blocked"));

    const result = await probeUpstreamApi({
      baseUrl: "https://169.254.169.254/v1",
      apiKey: "sk-test",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unreachable");
    expect(result.httpStatus).toBeUndefined();
  });

  it("网络/超时异常判定为 unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("Request timed out after 10000ms"));

    const result = await probeUpstreamApi({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unreachable");
    expect(result.message).toContain("timed out");
  });

  it("非法 baseUrl 直接返回 unreachable，不发起请求", async () => {
    const result = await probeUpstreamApi({
      baseUrl: "not a url",
      apiKey: "sk-test",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unreachable");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("timeoutMs 被 clamp 到上限 20000", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    await probeUpstreamApi({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      timeoutMs: 999_999,
    });

    const [, init] = mockFetch.mock.lastCall ?? [];
    expect(init?.timeoutMs).toBe(20_000);
  });
});
