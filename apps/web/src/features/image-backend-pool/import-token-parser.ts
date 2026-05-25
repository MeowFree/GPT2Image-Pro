type TokenParseMode = "refresh" | "access" | "none";

function normalizeImportedToken(value: string | null | undefined) {
  let token = value?.trim() || "";
  token = token.replace(/^Bearer\s+/i, "").trim();
  token = token.replace(/^["'`]+/, "").replace(/["'`,;]+$/, "").trim();
  token = token.replace(/^Bearer\s+/i, "").trim();
  return token.replace(/^["'`]+/, "").replace(/["'`,;]+$/, "").trim();
}

function addToken(tokens: Set<string>, value: string | null | undefined) {
  const token = normalizeImportedToken(value);
  if (token) tokens.add(token);
}

function isRefreshToken(value: string) {
  return /^rt_[A-Za-z0-9._~+/=-]+$/.test(normalizeImportedToken(value));
}

function isLikelyPlainAccessToken(value: string) {
  const token = normalizeImportedToken(value);
  if (!token || token.startsWith("rt_")) return false;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,3}$/.test(token)) {
    return true;
  }
  return token.length >= 80 && !/\s/.test(token);
}

function addAccessToken(tokens: Set<string>, value: string | null | undefined) {
  const token = normalizeImportedToken(value);
  if (token && token.length >= 40 && !token.startsWith("rt_")) {
    tokens.add(token);
  }
}

function collectTokensFromJson(
  value: unknown,
  tokens: { refreshTokens: Set<string>; accessTokens: Set<string> },
  mode: TokenParseMode,
  allowBareString = false
) {
  if (!value) return;
  if (typeof value === "string") {
    const token = normalizeImportedToken(value);
    if (!allowBareString) return;
    if (mode === "refresh" && isRefreshToken(token)) {
      tokens.refreshTokens.add(token);
    }
    if (mode === "access" && isLikelyPlainAccessToken(token)) {
      tokens.accessTokens.add(token);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTokensFromJson(item, tokens, mode, true);
    return;
  }
  if (typeof value !== "object") return;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, "");
    if (typeof item === "string") {
      if (["refreshtoken", "rt", "refresh"].includes(normalizedKey)) {
        addToken(tokens.refreshTokens, item);
        continue;
      }
      if (["accesstoken", "at", "access"].includes(normalizedKey)) {
        addAccessToken(tokens.accessTokens, item);
        continue;
      }
    }
    collectTokensFromJson(item, tokens, mode);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNamedTokens(value: string, names: string[]) {
  const namePattern = names.map(escapeRegExp).join("|");
  const pattern = new RegExp(
    `(?:^|[\\s,{\\[])(?:"(?:${namePattern})"|'(?:${namePattern})'|(?:${namePattern}))\\s*[:=]\\s*(?:"([^"]+)"|'([^']+)'|([^"',}\\]\\s;]+))`,
    "gi"
  );
  const results: string[] = [];
  for (const match of value.matchAll(pattern)) {
    const token = match[1] || match[2] || match[3];
    if (token) results.push(token);
  }
  return results;
}

function lineTokenCandidate(value: string) {
  const line = value.trim();
  if (!line) return "";
  const bearerMatch = line.match(/\bBearer\s+([^\s"'`,;]+)/i);
  if (bearerMatch?.[1]) return normalizeImportedToken(bearerMatch[1]);
  return normalizeImportedToken(line.replace(/^[>\-*•\s]+/, ""));
}

function addPlainFallbackTokens(
  value: string,
  tokens: { refreshTokens: Set<string>; accessTokens: Set<string> },
  mode: TokenParseMode
) {
  for (const line of value.split(/\r?\n/g)) {
    const token = lineTokenCandidate(line);
    if (mode === "refresh" && token) {
      tokens.refreshTokens.add(token);
    }
    if (mode === "access" && isLikelyPlainAccessToken(token)) {
      tokens.accessTokens.add(token);
    }
  }

  for (const item of value.split(/[\s,;]+/g)) {
    const token = normalizeImportedToken(item);
    if (mode === "refresh" && token) {
      tokens.refreshTokens.add(token);
    }
    if (mode === "access" && isLikelyPlainAccessToken(token)) {
      tokens.accessTokens.add(token);
    }
  }
}

export function parseImportTokensText(
  value: string,
  options: { plainFallback: TokenParseMode } = {
    plainFallback: "refresh",
  }
) {
  const tokens = {
    refreshTokens: new Set<string>(),
    accessTokens: new Set<string>(),
  };

  try {
    collectTokensFromJson(JSON.parse(value), tokens, options.plainFallback);
    if (tokens.refreshTokens.size || tokens.accessTokens.size) {
      return {
        refreshTokens: Array.from(tokens.refreshTokens),
        accessTokens: Array.from(tokens.accessTokens),
      };
    }
  } catch {
    // Plain RT/AT lists and copied pages are handled by the text parser below.
  }

  for (const match of value.matchAll(/\brt_[A-Za-z0-9._~+/=-]+/g)) {
    tokens.refreshTokens.add(match[0]);
  }

  for (const token of extractNamedTokens(value, [
    "refresh_token",
    "refreshToken",
    "rt",
  ])) {
    addToken(tokens.refreshTokens, token);
  }
  for (const token of extractNamedTokens(value, [
    "access_token",
    "accessToken",
    "at",
  ])) {
    addAccessToken(tokens.accessTokens, token);
  }

  const looksStructured =
    /(?:^|[\s{,])["']?(?:access[_-]?token|accessToken|refresh[_-]?token|refreshToken)["']?\s*[:=]/i.test(
      value
    );
  if (
    !tokens.refreshTokens.size &&
    !tokens.accessTokens.size &&
    !looksStructured
  ) {
    addPlainFallbackTokens(value, tokens, options.plainFallback);
  }

  return {
    refreshTokens: Array.from(tokens.refreshTokens),
    accessTokens: Array.from(tokens.accessTokens),
  };
}
