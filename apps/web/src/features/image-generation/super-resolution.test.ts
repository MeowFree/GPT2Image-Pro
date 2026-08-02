import { afterEach, describe, expect, it, vi } from "vitest";

import { superResolve } from "./super-resolution";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("superResolve", () => {
  it("sends image bytes to the dedicated worker", async () => {
    vi.stubEnv("SUPER_RESOLUTION_WORKER_URL", "http://worker.internal:4400");
    vi.stubEnv("SUPER_RESOLUTION_WORKER_SECRET", "worker-secret");
    const output = new Uint8Array([8, 9, 10]);
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(output)
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await superResolve(Buffer.from([1, 2, 3]));

    expect(result).toEqual(Buffer.from(output));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://worker.internal:4400/v1/super-resolution");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "content-type": "application/octet-stream",
      "content-length": "3",
      "x-super-resolution-secret": "worker-secret",
    });
    expect(init?.body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("uses the loopback worker by default", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(new Uint8Array([1]))
    );
    vi.stubGlobal("fetch", fetchMock);

    await superResolve(Buffer.from([1]));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:3310/v1/super-resolution"
    );
  });

  it("reports worker errors to the calibration fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("queue full", { status: 503 }))
    );

    await expect(superResolve(Buffer.from([1]))).rejects.toThrow(
      "super-resolution worker returned HTTP 503: queue full"
    );
  });

  it("rejects an empty worker response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null))
    );

    await expect(superResolve(Buffer.from([1]))).rejects.toThrow(
      "super-resolution worker returned an empty image"
    );
  });
});
