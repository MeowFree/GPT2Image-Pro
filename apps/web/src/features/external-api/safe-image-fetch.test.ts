import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/security/dns-pin", () => ({
  fetchWithDnsPin: vi.fn(),
  SsrfBlockedError: class SsrfBlockedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SsrfBlockedError";
    }
  },
}));

import { fetchWithDnsPin } from "@repo/shared/security/dns-pin";
import {
  assertPublicCallbackUrl,
  assertPublicImageUrl,
  fetchPublicCallback,
  fetchPublicImage,
  readResponseBytesWithLimit,
  SafeImageFetchError,
} from "./safe-image-fetch";

const mockFetchWithDnsPin = vi.mocked(fetchWithDnsPin);

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetchWithDnsPin.mockReset();
});

describe("assertPublicImageUrl", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data/", // 链路本地 / 云元数据
    "http://100.100.1.1/", // CGNAT（阿里云元数据段）
    "http://10.0.0.1/x.png",
    "http://127.0.0.1/x.png",
    "http://192.168.1.1/x.png",
    "http://172.16.0.1/x.png",
    "http://[::1]/x.png",
    "http://[fd00::1]/x.png",
    "http://localhost/x.png",
    "http://metadata.google.internal/x",
  ])("rejects private / loopback / metadata target %s", async (url) => {
    await expect(assertPublicImageUrl(new URL(url))).rejects.toBeInstanceOf(
      SafeImageFetchError
    );
  });

  it("rejects non-http(s) protocols and embedded credentials", async () => {
    await expect(
      assertPublicImageUrl(new URL("ftp://example.com/x.png"))
    ).rejects.toThrow("http or https");
    await expect(
      assertPublicImageUrl(new URL("https://user:pass@1.2.3.4/x.png"))
    ).rejects.toThrow("credentials");
  });

  it("allows a literal public IP", async () => {
    await expect(
      assertPublicImageUrl(new URL("https://1.1.1.1/x.png"))
    ).resolves.toBeUndefined();
  });
});

describe("fetchPublicImage", () => {
  it("rejects a redirect that targets a private IP", async () => {
    mockFetchWithDnsPin.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })
    );

    await expect(
      fetchPublicImage("https://1.1.1.1/image.png")
    ).rejects.toBeInstanceOf(SafeImageFetchError);
  });

  it("throws after exceeding the redirect budget", async () => {
    let counter = 0;
    mockFetchWithDnsPin.mockImplementation(async () => {
      counter += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://1.1.1.1/hop-${counter}.png` },
      });
    });

    await expect(
      fetchPublicImage("https://1.1.1.1/image.png")
    ).rejects.toThrow("Too many redirects");
  });

  it("returns the final response for a public URL", async () => {
    mockFetchWithDnsPin.mockResolvedValueOnce(
      new Response("ok", { status: 200 })
    );

    const response = await fetchPublicImage("https://1.1.1.1/image.png");
    expect(response.status).toBe(200);
  });

  it("retries on 429 then succeeds", async () => {
    vi.useFakeTimers();
    try {
      mockFetchWithDnsPin
        .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
        .mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const promise = fetchPublicImage("https://1.1.1.1/image.png");
      // 推进退避计时器以触发第二次尝试。
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(200);
      expect(mockFetchWithDnsPin).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries on 5xx and surfaces the last response after exhausting retries", async () => {
    vi.useFakeTimers();
    try {
      mockFetchWithDnsPin.mockResolvedValue(
        new Response("boom", { status: 503 })
      );

      const promise = fetchPublicImage("https://1.1.1.1/image.png");
      await vi.runAllTimersAsync();
      const response = await promise;

      expect(response.status).toBe(503);
      // 首次 + MAX_TRANSIENT_RETRIES 次重试 = 4 次调用。
      expect(mockFetchWithDnsPin).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("assertPublicCallbackUrl", () => {
  it("rejects http callback URLs to keep results off plaintext", async () => {
    await expect(
      assertPublicCallbackUrl("http://example.com/callback")
    ).rejects.toThrow("https");
  });

  it("rejects a public https callback resolving to a private IP literal", async () => {
    await expect(
      assertPublicCallbackUrl("https://169.254.169.254/callback")
    ).rejects.toThrow("publicly reachable");
  });

  it("accepts a public https callback URL", async () => {
    const url = await assertPublicCallbackUrl("https://example.com/callback");
    expect(url.href).toBe("https://example.com/callback");
  });
});

describe("fetchPublicCallback", () => {
  it("does not follow a redirect to a private address", async () => {
    mockFetchWithDnsPin.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://10.0.0.5/internal" },
      })
    );

    await expect(
      fetchPublicCallback("https://1.1.1.1/callback", { body: "{}" })
    ).rejects.toBeInstanceOf(SafeImageFetchError);
    expect(mockFetchWithDnsPin).toHaveBeenCalledTimes(1);
  });
});

describe("readResponseBytesWithLimit", () => {
  function exceeded(): never {
    throw new SafeImageFetchError("too large", 413);
  }

  it("returns the buffer when under the limit", async () => {
    const response = new Response("hello");
    const buffer = await readResponseBytesWithLimit(response, 1024, exceeded);
    expect(buffer.toString()).toBe("hello");
  });

  it("aborts and throws once the streamed bytes exceed the limit", async () => {
    const big = "x".repeat(2048);
    const response = new Response(big);
    await expect(
      readResponseBytesWithLimit(response, 16, exceeded)
    ).rejects.toThrow("too large");
  });
});
