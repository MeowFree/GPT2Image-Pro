import { describe, expect, it } from "vitest";
import {
  classifyGenerationError,
  isContentSafetyRejection,
} from "./sla-classification";

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
      classifyGenerationError("API key quota exceeded: required 2, remaining 0")
    ).toBe("user_request");
  });

  it("keeps pool quota exhaustion and credential failures as platform errors", () => {
    // 裸 insufficient_quota/unauthorized 来自平台自有池(上游配额耗尽/池账号 401)，
    // 不能归 user_request 从 SLA 成功率分母中剔除。
    expect(
      classifyGenerationError(
        "Upstream Images API returned HTTP 429: no available image quota | insufficient_quota"
      )
    ).toBe("platform");
    expect(classifyGenerationError("insufficient_quota")).toBe("platform");
    expect(
      classifyGenerationError(
        "Upstream Responses API returned HTTP 401: Unauthorized"
      )
    ).toBe("platform");
  });

  it("keeps invalid request parameters out of moderation errors", () => {
    expect(
      classifyGenerationError(
        "Upstream Images API returned HTTP 400: Invalid moderation value"
      )
    ).toBe("user_request");
  });

  it("classifies updated OAI safety refusals as moderation errors", () => {
    const moderationErrors = [
      "Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID. safety_violations=[sexual].",
      "I’m sorry, but the edit request couldn’t be completed because the referenced image was flagged by the safety system.",
      "I can’t generate that exact image because the request is too sexually suggestive.",
      "I can't help create explicit sexual content.",
      "Sorry, I can’t help create that sexualized image.",
      "Sorry, I can’t create that exact cosplay photo from this reference. I can help with a safer version instead.",
      "Sorry, I can’t generate an image that includes targeted abusive text like “幹你”.",
      "Sorry, I can’t help create an image containing that abusive speech text.",
      "I’m sorry, but I can’t generate that image because it was flagged for sexual content.",
      "I’m sorry, but I couldn’t complete that image edit request as submitted.",
      "抱歉，我无法处理这张图片的增强请求，因为图像包含裸露/性暗示内容。",
      "抱歉，图像生成请求被系统拒绝了，当前无法返回生成图。",
      "抱歉，我不能保留带有人身辱骂含义的对白气泡“幹你”。",
      "抱歉，我无法按“米奇”这一受版权保护角色进行直接编辑。",
      "抱歉，这个请求包含明显性化的成人场景与穿着描写，我不能按原样生成。",
      "抱歉，这个请求因为涉及受版权保护角色的直接生成而未能通过。",
      "抱歉，这个请求里的“用笔扎自己”的画面被系统判定为涉及自伤，因此我不能直接生成该版本图像。",
      "抱歉，这个请求包含近距离打击关节、骨响惨叫等明确暴力伤害分镜，无法生成。",
    ];

    for (const error of moderationErrors) {
      expect(classifyGenerationError(error)).toBe("moderation");
      expect(isContentSafetyRejection(error)).toBe(true);
    }
  });

  it("keeps apology-only platform failures as platform errors", () => {
    const platformErrors = [
      "Sorry, the upstream service is temporarily unavailable. Please try again later.",
      "抱歉，服务暂时不可用，请稍后重试。",
      "aliyun: aliyun moderation timed out after 10000ms",
      "Content moderation failed",
      "aliyun: Aliyun moderation failed: 401",
      "aliyun: socket hang upPOST https://green-cip.ap-southeast-1.aliyuncs.com/ failed.",
      "Upstream Responses API returned HTTP 400: Error while downloading http://example.test/api/storage/generations/id/moderation/file.png. Upstream status code: 400. | invalid_value | invalid_request_error",
      "Upstream Responses API returned HTTP 400: Timeout while downloading http://example.test/api/storage/generations/id/moderation/file.png. | invalid_value | invalid_request_error",
    ];

    for (const error of platformErrors) {
      expect(classifyGenerationError(error)).toBe("platform");
      expect(isContentSafetyRejection(error)).toBe(false);
    }
  });
});
