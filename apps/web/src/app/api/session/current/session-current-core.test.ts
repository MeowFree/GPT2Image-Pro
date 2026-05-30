import { describe, expect, it } from "vitest";

import {
  AUTH_COOKIE_NAMES,
  type CurrentSessionUserRow,
  isAuthCookieName,
  toCurrentSessionUser,
} from "./session-current-core";

const baseRow: CurrentSessionUserRow = {
  id: "user_1",
  name: "Alice",
  email: "alice@example.com",
  image: null,
  role: "user",
  banned: false,
  bannedReason: null,
};

describe("toCurrentSessionUser", () => {
  it("projects all user fields including banned and bannedReason", () => {
    const result = toCurrentSessionUser(baseRow);

    expect(result).toEqual({
      id: "user_1",
      name: "Alice",
      email: "alice@example.com",
      image: null,
      role: "user",
      banned: false,
      bannedReason: null,
    });
  });

  it("preserves a banned user's reason", () => {
    const result = toCurrentSessionUser({
      ...baseRow,
      banned: true,
      bannedReason: "account_deleted",
    });

    expect(result.banned).toBe(true);
    expect(result.bannedReason).toBe("account_deleted");
  });

  it("carries through image and role values", () => {
    const result = toCurrentSessionUser({
      ...baseRow,
      image: "https://cdn.example.com/a.png",
      role: "super_admin",
    });

    expect(result.image).toBe("https://cdn.example.com/a.png");
    expect(result.role).toBe("super_admin");
  });
});

describe("isAuthCookieName", () => {
  it("matches every fixed better-auth cookie name", () => {
    for (const name of AUTH_COOKIE_NAMES) {
      expect(isAuthCookieName(name)).toBe(true);
    }
  });

  it("matches sharded session_data cookies via prefix", () => {
    expect(isAuthCookieName("better-auth.session_data.0")).toBe(true);
    expect(isAuthCookieName("better-auth.session_data.1")).toBe(true);
    expect(isAuthCookieName("__Secure-better-auth.session_data.0")).toBe(true);
  });

  it("does not match unrelated cookies", () => {
    expect(isAuthCookieName("theme")).toBe(false);
    expect(isAuthCookieName("NEXT_LOCALE")).toBe(false);
    expect(isAuthCookieName("better-auth")).toBe(false);
    expect(isAuthCookieName("not-better-auth.session_token")).toBe(false);
  });
});
