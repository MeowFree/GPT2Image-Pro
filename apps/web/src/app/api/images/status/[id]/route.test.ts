import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getImageOutputs } from "../status-output";

const TEST_SECRET = "test-secret-for-image-status-tests";

describe("image status output URLs", () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalSecret;
    }
  });

  it("re-signs stored output images instead of returning stale metadata URLs", () => {
    const outputs = getImageOutputs(
      {
        outputImage: {
          imageOutputs: [
            {
              generationId: "gen_1",
              imageUrl: "/api/storage/generations/user/out.png",
              storageKey: "user/out.png",
              role: "final",
            },
          ],
        },
      },
      "generations"
    );

    expect(outputs).toHaveLength(1);
    const url = new URL(outputs[0]!.imageUrl!, "https://example.com");
    expect(url.pathname).toBe("/api/storage/generations/user/out.png");
    expect(url.searchParams.get("sig")).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(url.searchParams.get("exp"))).toBeGreaterThan(
      Math.floor(Date.now() / 1000)
    );
  });
});
