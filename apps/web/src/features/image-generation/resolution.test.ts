import { describe, expect, it } from "vitest";

import {
  getImageBaseCredits,
  getImageCreditCostBreakdown,
  IMAGE_1024_BASE_PIXELS,
  MAX_IMAGE_PIXELS,
} from "./resolution";

describe("image resolution credit pricing", () => {
  it("keeps legacy default anchor prices for 1024 square and 4K", () => {
    expect(
      getImageCreditCostBreakdown("1024x1024", {
        textModerationCount: 0,
      }).baseCredits
    ).toBe(1.27);
    expect(
      getImageCreditCostBreakdown("3840x2160", {
        textModerationCount: 0,
      }).baseCredits
    ).toBe(10);
  });

  it("linearly interpolates between configured 1024 square and 4K prices", () => {
    const pricing = { base1024Credits: 2, base4kCredits: 20 };
    const halfwayPixels = (IMAGE_1024_BASE_PIXELS + MAX_IMAGE_PIXELS) / 2;

    expect(getImageBaseCredits(IMAGE_1024_BASE_PIXELS, pricing)).toBe(2);
    expect(getImageBaseCredits(MAX_IMAGE_PIXELS, pricing)).toBe(20);
    expect(getImageBaseCredits(halfwayPixels, pricing)).toBe(11);
  });

  it("clamps outside the configured anchor range", () => {
    const pricing = { base1024Credits: 2, base4kCredits: 20 };

    expect(getImageBaseCredits(512 * 512, pricing)).toBe(2);
    expect(getImageBaseCredits(MAX_IMAGE_PIXELS * 2, pricing)).toBe(20);
  });
});
