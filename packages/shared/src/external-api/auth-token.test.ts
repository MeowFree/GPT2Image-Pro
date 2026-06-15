import { describe, expect, it } from "vitest";

import { getBearerToken, hashApiKey, safeEqual } from "./auth-token";

function requestWith(authorization?: string) {
  return new Request("https://example.com/v1/images/generations", {
    headers: authorization ? { authorization } : {},
  });
}

describe("getBearerToken", () => {
  it("returns null for missing or non-Bearer authorization", () => {
    expect(getBearerToken(requestWith())).toBeNull();
    expect(getBearerToken(requestWith("Basic abc"))).toBeNull();
    expect(getBearerToken(requestWith("Bearer    "))).toBeNull();
  });

  it("extracts and trims the bearer token", () => {
    expect(getBearerToken(requestWith("Bearer sk-123"))).toBe("sk-123");
    expect(getBearerToken(requestWith("Bearer  sk-456 "))).toBe("sk-456");
  });
});

describe("safeEqual", () => {
  it("returns false for different-length inputs without throwing", () => {
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("returns true only for identical strings", () => {
    expect(safeEqual("same-value", "same-value")).toBe(true);
    expect(safeEqual("value-a", "value-b")).toBe(false);
  });
});

describe("hashApiKey", () => {
  it("produces a stable lowercase hex sha256 digest", () => {
    const digest = hashApiKey("sk-123");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("sk-123")).toBe(digest);
    expect(hashApiKey("sk-124")).not.toBe(digest);
  });
});
