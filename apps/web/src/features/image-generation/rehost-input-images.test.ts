import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageInputFile } from "./types";

const runtimeSettingMock = vi.hoisted(() => vi.fn());
const storageMocks = vi.hoisted(() => {
  const putObject = vi.fn();
  return {
    putObject,
    getStorageProvider: vi.fn(async () => ({ putObject })),
  };
});
const fetchMocks = vi.hoisted(() => ({
  fetchPublicImage: vi.fn(),
}));
const logMock = vi.hoisted(() => ({ logWarn: vi.fn() }));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: runtimeSettingMock,
}));

vi.mock("@repo/shared/storage/providers", () => ({
  getStorageProvider: storageMocks.getStorageProvider,
}));

vi.mock("@repo/shared/logger", () => logMock);

vi.mock("../external-api/safe-image-fetch", () => ({
  fetchPublicImage: fetchMocks.fetchPublicImage,
  // readResponseBytesWithLimit 走真实实现，直接读 Response 字节。
  readResponseBytesWithLimit: async (response: Response) =>
    Buffer.from(await response.arrayBuffer()),
}));

// request-utils 依赖 getImagePublicBaseUrl，它读取 runtimeSettingMock。

import { ensureInputImageRehosted } from "./rehost-input-images";

function makeImage(overrides: Partial<ImageInputFile>): ImageInputFile {
  return {
    data: Buffer.alloc(0),
    name: "image.png",
    type: "image/png",
    ...overrides,
  };
}

const ctx = { userId: "user-1", generationId: "gen-1", index: 0 };

beforeEach(() => {
  runtimeSettingMock.mockReset();
  runtimeSettingMock.mockImplementation(async (key: string) => {
    if (key === "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME") return "generations";
    if (key === "NEXT_PUBLIC_APP_URL") return "https://app.example.test";
    return "";
  });
  storageMocks.putObject.mockReset();
  storageMocks.getStorageProvider.mockClear();
  fetchMocks.fetchPublicImage.mockReset();
  logMock.logWarn.mockReset();
  process.env.BETTER_AUTH_SECRET = "test-secret";
});

describe("ensureInputImageRehosted", () => {
  it("returns the image unchanged when it already has a storageKey", async () => {
    const image = makeImage({
      storageKey: "user-1/abc.png",
      storageBucket: "generations",
    });
    const result = await ensureInputImageRehosted(image, ctx);
    expect(result).toBe(image);
    expect(storageMocks.putObject).not.toHaveBeenCalled();
    expect(fetchMocks.fetchPublicImage).not.toHaveBeenCalled();
  });

  it("returns the image unchanged when url is first-party", async () => {
    const image = makeImage({
      url: "https://app.example.test/api/storage/generations/user-1/x.png?sig=a&exp=1",
    });
    const result = await ensureInputImageRehosted(image, ctx);
    expect(result).toBe(image);
    expect(storageMocks.putObject).not.toHaveBeenCalled();
    expect(fetchMocks.fetchPublicImage).not.toHaveBeenCalled();
  });

  it("uploads existing bytes for an external url without downloading", async () => {
    const image = makeImage({
      url: "https://cdn.thirdparty.example/p.png",
      data: Buffer.from([1, 2, 3]),
      type: "image/png",
    });
    const result = await ensureInputImageRehosted(image, ctx);

    expect(fetchMocks.fetchPublicImage).not.toHaveBeenCalled();
    expect(storageMocks.putObject).toHaveBeenCalledWith(
      "user-1/rehost/gen-1-0.png",
      "generations",
      Buffer.from([1, 2, 3]),
      "image/png"
    );
    expect(result.storageKey).toBe("user-1/rehost/gen-1-0.png");
    expect(result.storageBucket).toBe("generations");
    expect(result.url).toContain(
      "/api/storage/generations/user-1/rehost/gen-1-0.png"
    );
  });

  it("downloads then uploads for an external url without bytes", async () => {
    fetchMocks.fetchPublicImage.mockResolvedValue(
      new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })
    );
    const image = makeImage({
      url: "https://cdn.thirdparty.example/history.png",
    });
    const result = await ensureInputImageRehosted(image, ctx);

    expect(fetchMocks.fetchPublicImage).toHaveBeenCalledTimes(1);
    expect(storageMocks.putObject).toHaveBeenCalledWith(
      "user-1/rehost/gen-1-0.jpg",
      "generations",
      Buffer.from([9, 8, 7]),
      "image/jpeg"
    );
    expect(result.storageKey).toBe("user-1/rehost/gen-1-0.jpg");
  });

  it("keeps bytes when upload fails", async () => {
    storageMocks.putObject.mockRejectedValue(new Error("storage down"));
    const image = makeImage({
      url: "https://cdn.thirdparty.example/p.png",
      data: Buffer.from([1, 2, 3]),
    });
    const result = await ensureInputImageRehosted(image, ctx);

    expect(result.storageKey).toBeUndefined();
    expect(result.data).toEqual(Buffer.from([1, 2, 3]));
    expect(logMock.logWarn).toHaveBeenCalled();
  });

  it("keeps the original url when download fails", async () => {
    fetchMocks.fetchPublicImage.mockRejectedValue(new Error("429"));
    const image = makeImage({
      url: "https://cdn.thirdparty.example/history.png",
    });
    const result = await ensureInputImageRehosted(image, ctx);

    expect(result.storageKey).toBeUndefined();
    expect(result.url).toBe("https://cdn.thirdparty.example/history.png");
    expect(storageMocks.putObject).not.toHaveBeenCalled();
    expect(logMock.logWarn).toHaveBeenCalled();
  });
});
