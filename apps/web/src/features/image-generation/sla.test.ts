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
      classifyGenerationError("API key quota exceeded: required 2, remaining 0")
    ).toBe("user_request");
    expect(classifyGenerationError("insufficient_quota")).toBe("user_request");
  });

  it("classifies updated OAI safety refusals as moderation errors", () => {
    const moderationErrors = [
      "Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID. safety_violations=[sexual].",
      "I’m sorry, but the edit request couldn’t be completed because the referenced image was flagged by the safety system.",
      "I can’t generate that exact image because the request is too sexually suggestive.",
      "I can't help create explicit sexual content.",
      "Sorry, I can’t help create that sexualized image.",
      "I’m sorry, but I can’t generate that image because it was flagged for sexual content.",
      "抱歉，我无法处理这张图片的增强请求，因为图像包含裸露/性暗示内容。",
      "抱歉，这个请求包含明显性化的成人场景与穿着描写，我不能按原样生成。",
      "抱歉，这个请求因为涉及受版权保护角色的直接生成而未能通过。",
      "抱歉，这个请求里的“用笔扎自己”的画面被系统判定为涉及自伤，因此我不能直接生成该版本图像。",
      "抱歉，这个请求包含近距离打击关节、骨响惨叫等明确暴力伤害分镜，无法生成。",
    ];

    for (const error of moderationErrors) {
      expect(classifyGenerationError(error)).toBe("moderation");
    }
  });
});
