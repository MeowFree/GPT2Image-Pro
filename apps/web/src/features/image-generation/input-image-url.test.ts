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
});
