import { describe, expect, it } from "vitest";

import {
  fetchCreditsBalance,
  IMS_DEFAULT_SCOPE,
  refreshAccessTokenFromCookie,
} from "./auth";
import type {
  FireflyTransport,
  FireflyTransportRequest,
  FireflyTransportResponse,
} from "./transport";

function jsonResponse(status: number, body: unknown): FireflyTransportResponse {
  const bytes = Buffer.from(JSON.stringify(body), "utf-8");
  return {
    status,
    headers: {},
    bytes: async () => bytes,
    text: async () => bytes.toString("utf-8"),
    json: async () => body,
  };
}

class MockTransport implements FireflyTransport {
  calls: FireflyTransportRequest[] = [];

  constructor(private readonly response: FireflyTransportResponse) {}

  async request(
    request: FireflyTransportRequest
  ): Promise<FireflyTransportResponse> {
    this.calls.push(request);
    return this.response;
  }
}

function makeToken(payload: Record<string, unknown>): string {
  return `${Buffer.from("{}").toString("base64url")}.${Buffer.from(
    JSON.stringify(payload)
  ).toString("base64url")}.sig`;
}

describe("Adobe IMS Express identity", () => {
  it("refreshes with projectx_webapp and the reduced default scope", async () => {
    const transport = new MockTransport(
      jsonResponse(200, { access_token: "access-token", expires_in: 3600 })
    );

    await refreshAccessTokenFromCookie(transport, "aux_sid=abc", {
      fetchAccount: false,
      scope: "legacy,profile",
    });

    const request = transport.calls[0];
    expect(request?.headers.Origin).toBe("https://new.express.adobe.com");
    expect(request?.headers.Referer).toBe("https://new.express.adobe.com/");
    const form = new URLSearchParams(String(request?.body));
    expect(form.get("client_id")).toBe("projectx_webapp");
    expect(form.get("scope")).toBe(IMS_DEFAULT_SCOPE);
    expect(form.get("scope")).toBe("AdobeID,firefly_api,openid");
  });

  it("uses the Express origin for credits while retaining its API key", async () => {
    const transport = new MockTransport(
      jsonResponse(200, {
        total: { quota: { total: 100, used: 25, available: 75 } },
      })
    );

    await fetchCreditsBalance(transport, makeToken({ user_id: "user-1" }));

    const headers = transport.calls[0]?.headers;
    expect(headers?.["x-api-key"]).toBe("SunbreakWebUI1");
    expect(headers?.Origin).toBe("https://new.express.adobe.com");
    expect(headers?.Referer).toBe("https://new.express.adobe.com/");
  });
});
