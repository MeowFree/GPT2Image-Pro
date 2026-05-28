import { describe, expect, it } from "vitest";

async function loadClassifier() {
  process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
  const service = await import("./service");
  return service.isImageBackendSwitchableError;
}

describe("image backend error classification", () => {
  it("treats transient connection termination as switchable", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(isImageBackendSwitchableError("terminated")).toBe(true);
    expect(
      isImageBackendSwitchableError("TypeError: terminated at Fetch.onAborted")
    ).toBe(true);
    expect(isImageBackendSwitchableError("socket hang up")).toBe(true);
    expect(isImageBackendSwitchableError("other side closed")).toBe(true);
  });

  it("does not switch accounts after the global request timeout aborts", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(
      isImageBackendSwitchableError(
        "The operation was aborted due to timeout"
      )
    ).toBe(false);
  });

  it("switches accounts for Web quota exhaustion text returned with HTTP 200", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(isImageBackendSwitchableError("The quota has been exceeded.")).toBe(
      true
    );
  });

  it("does not switch accounts for user safety rejections", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(
      isImageBackendSwitchableError(
        "Your request was rejected by the safety system."
      )
    ).toBe(false);
    expect(isImageBackendSwitchableError("image_generation_user_error")).toBe(
      false
    );
  });
});
