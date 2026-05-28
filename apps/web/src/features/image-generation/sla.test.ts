import { describe, expect, it } from "vitest";
import { classifyGenerationError } from "./sla-classification";

describe("generation SLA error classification", () => {
  it("excludes account credit shortage from platform errors", () => {
    expect(classifyGenerationError("Insufficient credits")).toBe(
      "user_request"
    );
    expect(classifyGenerationError("积分不足: 需要 1.27，可用 0.5")).toBe(
      "user_request"
    );
  });

  it("excludes external API key quota shortage from platform errors", () => {
    expect(
      classifyGenerationError(
        "API key quota exceeded: required 2, remaining 0"
      )
    ).toBe("user_request");
    expect(classifyGenerationError("insufficient_quota")).toBe("user_request");
  });
});
