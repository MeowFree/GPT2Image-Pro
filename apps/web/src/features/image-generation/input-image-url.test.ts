import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImageInputFile } from "./types";

const APP_URL = "https://app.example.test";

let previousAppUrl: string | undefined;
let previousAuthUrl: string | undefined;
let previousSecret: string | undefined;

beforeEach(() => {
  previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  previousAuthUrl = process.env.BETTER_AUTH_URL;
  previousSecret = process.env.BETTER_AUTH_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
  process.env.BETTER_AUTH_URL = previousAuthUrl;
  process.env.BETTER_AUTH_SECRET = previousSecret;
});

function makeImage(overrides: Partial<ImageInputFile>): ImageInputFile {
  return {
    data: Buffer.alloc(0),
    name: "image.png",
    type: "image/png",
    ...overrides,
  };
}

describe("getInputImageUrl", () => {
  it("uses an in-app signed storage URL when storageKey is present", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const url = getInputImageUrl(
      makeImage({
        storageKey: "user-1/abc.png",
        storageBucket: "generations",
        data: Buffer.from([1, 2, 3]),
      })
    );
    expect(url).toContain(`${APP_URL}/api/storage/generations/user-1/abc.png`);
    expect(url).toContain("sig=");
  });

  it("passes through a first-party storage url", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const firstParty = `${APP_URL}/api/storage/generations/user-1/abc.png?sig=x&exp=1`;
    const url = getInputImageUrl(
      makeImage({ url: firstParty, data: Buffer.from([1, 2, 3]) })
    );
    expect(url).toBe(firstParty);
  });

  it("returns base64 for an external url when bytes are available", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const url = getInputImageUrl(
      makeImage({
        url: "https://cdn.thirdparty.example/photo.png",
        data: Buffer.from([1, 2, 3]),
        type: "image/png",
      })
    );
    expect(url).toBe(
      `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`
    );
  });

  it("falls back to passing the external url through when there are no bytes", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const external = "https://cdn.thirdparty.example/history.png";
    const url = getInputImageUrl(makeImage({ url: external }));
    expect(url).toBe(external);
  });

  it("returns a data: url unchanged", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const dataUrl = "data:image/png;base64,AAAA";
    const url = getInputImageUrl(makeImage({ url: dataUrl }));
    expect(url).toBe(dataUrl);
  });

  it("forces base64 even when a storage key / url are set, if bytes exist", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const bytes = Buffer.from([1, 2, 3]);
    const image = makeImage({
      storageKey: "user-1/abc.png",
      storageBucket: "generations",
      url: `${APP_URL}/api/storage/generations/user-1/abc.png?sig=x&exp=1`,
      data: bytes,
      type: "image/png",
    });

    // 无 forceBase64：仍走站内签名 URL（既有行为不变）。
    const normalUrl = getInputImageUrl(image);
    expect(normalUrl).toContain(
      `${APP_URL}/api/storage/generations/user-1/abc.png`
    );

    // forceBase64：跳过 URL 选择，直接内联 base64。
    const forcedUrl = getInputImageUrl(image, { forceBase64: true });
    expect(forcedUrl).toBe(
      `data:image/png;base64,${bytes.toString("base64")}`
    );
  });

  it("ignores forceBase64 when there are no bytes (keeps url passthrough)", async () => {
    const { getInputImageUrl } = await import("./input-image-url");
    const external = "https://cdn.thirdparty.example/history.png";
    const url = getInputImageUrl(makeImage({ url: external }), {
      forceBase64: true,
    });
    expect(url).toBe(external);
  });
});

describe("isImageDownloadUpstreamError", () => {
  it("matches the upstream download-failure messages", async () => {
    const { isImageDownloadUpstreamError } = await import("./input-image-url");
    expect(
      isImageDownloadUpstreamError(
        "Error while downloading file. Upstream status code: 407."
      )
    ).toBe(true);
    expect(
      isImageDownloadUpstreamError(
        "Unable to download content from the provided URL"
      )
    ).toBe(true);
  });

  it("does not match unrelated errors or empty input", async () => {
    const { isImageDownloadUpstreamError } = await import("./input-image-url");
    expect(isImageDownloadUpstreamError("moderation_blocked")).toBe(false);
    expect(isImageDownloadUpstreamError(undefined)).toBe(false);
    expect(isImageDownloadUpstreamError("")).toBe(false);
  });
});
