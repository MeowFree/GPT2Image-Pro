import { describe, expect, it } from "vitest";

async function loadClassifier() {
  process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
  const service = await import("./service");
  return service.isImageBackendSwitchableError;
}

async function loadService() {
  process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
  return import("./service");
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

  it("treats token-count download 429 as switchable, not a user error", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    // count_token 失败：上游为算 token 下载我方图片被限流(429)，属瞬时，应可切后端。
    expect(
      isImageBackendSwitchableError(
        "Upstream Responses API returned HTTP 500: error getting file type: failed to download file, status code: 429 (request id: x) | count_token_failed | new_api_error"
      )
    ).toBe(true);
    // 5xx/超时同理。
    expect(
      isImageBackendSwitchableError(
        "error getting file type: failed to download file, status code: 522 | count_token_failed"
      )
    ).toBe(true);
    // 但客户端原因(403/坏链)仍算用户错、不切换。
    expect(
      isImageBackendSwitchableError(
        "error getting file type: failed to download file, status code: 403 | count_token_failed"
      )
    ).toBe(false);
  });

  it("marks image-generation-disabled backends (403 permission) switchable and as error", async () => {
    const svc = await loadService();
    const err =
      "Upstream Responses API returned HTTP 403: Image generation is not enabled for this group | permission_error";

    expect(svc.isImageGenDisabledBackendError(err)).toBe(true);
    expect(svc.isImageBackendSwitchableError(err)).toBe(true);
    const failure = await svc.classifyFailure(err);
    expect(failure.status).toBe("error");
  });

  it("switches accounts when the backend lacks an image_generation tool", async () => {
    const isImageBackendSwitchableError = await loadClassifier();

    // 上游模型没有图像工具、只回文字：应可切换到别的后端（而非当场失败）。
    expect(
      isImageBackendSwitchableError(
        "Upstream returned no image output: 抱歉，当前环境未提供可调用的 image_generation 图像生成工具，因此我无法直接返回生成后的图片。"
      )
    ).toBe(true);
    expect(
      isImageBackendSwitchableError(
        "Upstream returned no image output: Sorry, the image_generation tool is not available in this environment."
      )
    ).toBe(true);
  });

  it("classifies missing image tool only when capability is absent", async () => {
    const { isMissingImageToolBackendError } = await loadService();

    // 命中：缺图像工具/不可用。
    expect(
      isMissingImageToolBackendError(
        "抱歉，当前环境未提供可调用的 image_generation 图像生成工具。"
      )
    ).toBe(true);
    expect(
      isMissingImageToolBackendError(
        "the image_generation tool is not available"
      )
    ).toBe(true);
    // 不命中：真正的内容拒绝（无图像工具字样），保持用户拒绝语义、不切换。
    expect(
      isMissingImageToolBackendError(
        "抱歉，图像生成请求被系统拒绝了，当前无法返回生成图。"
      )
    ).toBe(false);
    expect(
      isMissingImageToolBackendError("Upstream returned no image output: 已生成图片。")
    ).toBe(false);
    expect(isMissingImageToolBackendError("I can't help with that.")).toBe(false);
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
