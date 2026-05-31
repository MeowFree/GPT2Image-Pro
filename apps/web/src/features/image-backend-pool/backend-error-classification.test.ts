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
      isImageBackendSwitchableError("The operation was aborted due to timeout")
    ).toBe(false);
  });

  it("switches accounts for Web quota exhaustion text returned with HTTP 200", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(isImageBackendSwitchableError("The quota has been exceeded.")).toBe(
      true
    );
  });

  it("switches accounts when Responses finishes without a final image", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(
      isImageBackendSwitchableError(
        "Upstream returned no image output: 已生成图片。"
      )
    ).toBe(true);
  });

  it("switches accounts for Codex Responses 429 usage limits", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(
      isImageBackendSwitchableError(
        "Upstream Responses API returned HTTP 429: The usage limit has been reached | usage_limit_reached"
      )
    ).toBe(true);
    expect(
      isImageBackendSwitchableError(
        "Upstream Responses API returned HTTP 429: Rate limit exceeded"
      )
    ).toBe(true);
  });

  it("does not switch accounts for Codex Responses invalid input 400s", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(
      isImageBackendSwitchableError(
        "Upstream Responses API returned HTTP 400: The image data you provided does not represent a valid image. Please check your input and try again. | invalid_value | invalid_request_error"
      )
    ).toBe(false);
    expect(
      isImageBackendSwitchableError(
        "Upstream Responses API returned HTTP 400: Error while downloading file. Upstream status code: 502. | invalid_value | invalid_request_error"
      )
    ).toBe(false);
  });

  it("does not switch accounts for user safety rejections", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    expect(
      isImageBackendSwitchableError(
        "Your request was rejected by the safety system."
      )
    ).toBe(false);
    expect(
      isImageBackendSwitchableError(
        "I can't help create explicit sexual content."
      )
    ).toBe(false);
    expect(
      isImageBackendSwitchableError(
        "Sorry, I can’t create that exact cosplay photo from this reference. I can help with a safer version instead."
      )
    ).toBe(false);
    expect(
      isImageBackendSwitchableError(
        "抱歉，图像生成请求被系统拒绝了，当前无法返回生成图。"
      )
    ).toBe(false);
    expect(isImageBackendSwitchableError("image_generation_user_error")).toBe(
      false
    );
  });
});
