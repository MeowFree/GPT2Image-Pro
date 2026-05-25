import { describe, expect, it } from "vitest";

import { parseImportTokensText } from "./import-token-parser";

const jwtA = `${"a".repeat(24)}.${"b".repeat(48)}.${"c".repeat(48)}`;
const jwtB = `${"e".repeat(24)}.${"f".repeat(48)}.${"g".repeat(48)}`;

describe("image backend import token parser", () => {
  it("parses one access token per line", () => {
    const result = parseImportTokensText(`${jwtA}\n${jwtB}`, {
      plainFallback: "access",
    });

    expect(result.accessTokens).toEqual([jwtA, jwtB]);
    expect(result.refreshTokens).toEqual([]);
  });

  it("parses bearer access token lines with quotes and commas", () => {
    const result = parseImportTokensText(`"Bearer ${jwtA}",\nBearer ${jwtB}`, {
      plainFallback: "access",
    });

    expect(result.accessTokens).toEqual([jwtA, jwtB]);
  });

  it("parses access tokens from auth session JSON", () => {
    const result = parseImportTokensText(
      JSON.stringify({
        accessToken: jwtA,
        sessionToken: "not-an-access-token",
      }),
      { plainFallback: "access" }
    );

    expect(result.accessTokens).toEqual([jwtA]);
  });

  it("parses JSON arrays of access tokens", () => {
    const result = parseImportTokensText(JSON.stringify([jwtA, jwtB]), {
      plainFallback: "access",
    });

    expect(result.accessTokens).toEqual([jwtA, jwtB]);
  });
});
