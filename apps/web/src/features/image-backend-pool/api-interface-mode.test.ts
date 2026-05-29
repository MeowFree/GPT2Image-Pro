import { describe, expect, it } from "vitest";

import {
  imageBackendApiInterfaceAllowsRequest,
  imageBackendApiUsesResponsesEndpoint,
  normalizeImageBackendApiInterfaceMode,
} from "./api-interface-mode";

describe("image backend API interface mode", () => {
  it("keeps existing rows images-only by default", () => {
    expect(normalizeImageBackendApiInterfaceMode(undefined)).toBe("images");
    expect(
      imageBackendApiInterfaceAllowsRequest("images", "image_generation")
    ).toBe(true);
    expect(imageBackendApiInterfaceAllowsRequest("images", "image_edit")).toBe(
      true
    );
    expect(imageBackendApiInterfaceAllowsRequest("images", "chat")).toBe(false);
    expect(imageBackendApiInterfaceAllowsRequest("images", "responses")).toBe(
      false
    );
  });

  it("keeps responses-only API backends on responses and chat requests", () => {
    expect(
      imageBackendApiInterfaceAllowsRequest("responses", "image_generation")
    ).toBe(false);
    expect(
      imageBackendApiInterfaceAllowsRequest("responses", "image_edit")
    ).toBe(false);
    expect(imageBackendApiInterfaceAllowsRequest("responses", "chat")).toBe(
      true
    );
    expect(
      imageBackendApiInterfaceAllowsRequest("responses", "responses")
    ).toBe(true);
    expect(imageBackendApiUsesResponsesEndpoint("responses", "image_edit")).toBe(
      false
    );
    expect(
      imageBackendApiUsesResponsesEndpoint("responses", "image_generation")
    ).toBe(false);
    expect(imageBackendApiUsesResponsesEndpoint("responses", "chat")).toBe(
      true
    );
  });

  it("uses native image endpoints for mixed image requests and responses for chat", () => {
    expect(
      imageBackendApiInterfaceAllowsRequest("mixed", "image_generation")
    ).toBe(true);
    expect(imageBackendApiInterfaceAllowsRequest("mixed", "chat")).toBe(true);
    expect(
      imageBackendApiUsesResponsesEndpoint("mixed", "image_generation")
    ).toBe(false);
    expect(imageBackendApiUsesResponsesEndpoint("mixed", "image_edit")).toBe(
      false
    );
    expect(
      imageBackendApiUsesResponsesEndpoint("mixed", "image_edit", true)
    ).toBe(false);
    expect(
      imageBackendApiUsesResponsesEndpoint("images", "image_edit", true)
    ).toBe(false);
    expect(imageBackendApiUsesResponsesEndpoint("mixed", "chat")).toBe(true);
    expect(imageBackendApiUsesResponsesEndpoint("mixed", "responses")).toBe(
      true
    );
  });
});
