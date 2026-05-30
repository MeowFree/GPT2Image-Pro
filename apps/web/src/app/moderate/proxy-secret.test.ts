import { describe, expect, it } from "vitest";

import { secretMatchesAny } from "./proxy-secret";

describe("secretMatchesAny", () => {
  it("matches when the token equals one of the configured secrets", () => {
    expect(secretMatchesAny("beta", ["alpha", "beta", "gamma"])).toBe(true);
  });

  it("does not match when the token equals none of the secrets", () => {
    expect(secretMatchesAny("delta", ["alpha", "beta", "gamma"])).toBe(false);
  });

  it("never matches an empty token even with secrets configured", () => {
    expect(secretMatchesAny("", ["alpha"])).toBe(false);
  });

  it("never matches when no secrets are configured", () => {
    expect(secretMatchesAny("alpha", [])).toBe(false);
  });

  it("matches only the exact secret, not a prefix or substring", () => {
    expect(secretMatchesAny("alph", ["alpha"])).toBe(false);
    expect(secretMatchesAny("alpha-extra", ["alpha"])).toBe(false);
  });
});
