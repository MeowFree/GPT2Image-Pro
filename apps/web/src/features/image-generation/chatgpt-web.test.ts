import { describe, expect, it, vi } from "vitest";
import { __testing__ } from "./chatgpt-web";

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingString: vi.fn(async () => undefined),
}));

describe("ChatGPT Web image choices", () => {
  it("extracts too many requests from Web JSON error payloads", () => {
    expect(
      __testing__.extractWebErrorPayloadMessage(
        JSON.stringify({ detail: "Too many requests" })
      )
    ).toBe("Too many requests");
  });

  it("extracts quota errors from Web HTTP 200 plain text streams", () => {
    expect(
      __testing__.extractWebStreamError("The quota has been exceeded.")
    ).toBe("The quota has been exceeded.");
  });

  it("递归取出包在 o/v 流式增量 v 里的错误文案", () => {
    expect(
      __testing__.extractWebErrorPayloadMessage(
        JSON.stringify({ o: "add", v: { detail: "Too many requests" } })
      )
    ).toBe("Too many requests");
  });

  it("命中错误条件但是 o/v 分片时,不回显原始分片,只给可读关键词短语", () => {
    const sse =
      'data: {"o":"add","v":{"message":{"id":"911374","content":{"parts":["You have hit your usage limit, try again later"]}}}}\n\n';
    const result = __testing__.extractWebStreamError(sse);
    expect(result).not.toContain('{"o"');
    expect(result.toLowerCase()).toContain("usage limit");
  });

  it("普通 o/v 消息增量(无错误关键词)不被当作错误", () => {
    const sse = 'data: {"o":"add","v":{"message":{"id":"abc"}}}\n\n';
    expect(__testing__.extractWebStreamError(sse)).toBe("");
  });

  it("把 ChatGPT 画图工具限流(system_error)从 o/v 流抽成错误,不回显原始分片", () => {
    const message = {
      id: "50f6deb3-9839-43fb-8da9-99fc55ace099",
      author: { role: "tool", name: "t2uay3k.sj1i4kz", metadata: {} },
      content: {
        content_type: "system_error",
        name: "ChatGPTAgentToolRateLimitException",
        text: "Before doing anything else, explicitly explain to the user that you were unable to invoke the image_gen.text2im tool right now. Make sure to begin your response with \"You've hit the Free plan limit for image generation.\"",
      },
    };
    const sse = `data: ${JSON.stringify({ o: "add", v: { message } })}\n\n`;
    const result = __testing__.extractWebStreamError(sse);
    expect(result).toContain("ChatGPTAgentToolRateLimitException");
    expect(result).toContain("image_gen.text2im");
    expect(result).not.toContain('{"o"');
  });

  it("extractWebSystemError 抽出嵌套在 o/v 里的 system_error name 与 text", () => {
    const result = __testing__.extractWebSystemError({
      o: "add",
      v: {
        message: {
          author: { role: "tool" },
          content: {
            content_type: "system_error",
            name: "ChatGPTAgentToolRateLimitException",
            text: "you were unable to invoke the image_gen.text2im tool right now",
          },
        },
      },
    });
    expect(result).toContain("ChatGPTAgentToolRateLimitException");
    expect(result).toContain("image_gen.text2im");
  });

  it("没有 system_error 的普通增量,extractWebSystemError 返回空", () => {
    expect(
      __testing__.extractWebSystemError({
        o: "add",
        v: { message: { id: "abc", content: { content_type: "text" } } },
      })
    ).toBe("");
  });

  it("extracts sibling image candidates after a request message", () => {
    const conversation = {
      current_node: "choice_b",
      mapping: {
        request_1: {
          id: "request_1",
          create_time: 100,
          children: ["selection_1"],
          message: { id: "request_1", create_time: 100 },
        },
        selection_1: {
          id: "selection_1",
          parent: "request_1",
          create_time: 101,
          children: ["choice_a", "choice_b"],
          message: {
            id: "select_message_1",
            metadata: { selected_image_message_id: "choice_message_a" },
          },
        },
        choice_b: {
          id: "choice_b",
          parent: "selection_1",
          create_time: 103,
          message: {
            id: "choice_message_b",
            content: {
              parts: [{ asset_pointer: "sediment://file_choice_b" }],
            },
            metadata: {
              image_gen_group_id: "group_1",
              generation_index: 2,
            },
          },
        },
        choice_a: {
          id: "choice_a",
          parent: "selection_1",
          create_time: 102,
          message: {
            id: "choice_message_a",
            content: {
              parts: [{ asset_pointer: "sediment://file_choice_a" }],
            },
            metadata: {
              image_gen_group_id: "group_1",
              generation_index: 1,
            },
          },
        },
      },
    };

    const candidates = __testing__.imageCandidatesAfterMessage(
      JSON.stringify(conversation),
      "request_1"
    );

    expect(candidates).toEqual([
      {
        fileIds: [],
        sedimentIds: ["file_choice_a"],
        messageId: "choice_message_a",
        groupId: "group_1",
        generationIndex: 1,
      },
      {
        fileIds: [],
        sedimentIds: ["file_choice_b"],
        messageId: "choice_message_b",
        groupId: "group_1",
        generationIndex: 2,
      },
    ]);
  });

  it("extracts the Web selection message id from SSE metadata", () => {
    const sse = [
      'data: {"v":{"id":"select_message_1","metadata":{"selected_image_message_id":"choice_message_a"}}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    expect(__testing__.extractSelectionMessageId(sse)).toBe("select_message_1");
  });

  it("extracts the Web selection message from conversation mapping", () => {
    const conversation = {
      current_node: "choice_a",
      mapping: {
        request_1: {
          id: "request_1",
          create_time: 100,
          children: ["selection_1"],
        },
        selection_1: {
          id: "selection_1",
          parent: "request_1",
          create_time: 101,
          message: {
            id: "select_message_1",
            metadata: { selected_image_message_id: "choice_message_a" },
          },
        },
        choice_a: {
          id: "choice_a",
          parent: "selection_1",
          create_time: 102,
          message: {
            id: "choice_message_a",
            content: {
              parts: [{ asset_pointer: "sediment://file_choice_a" }],
            },
            metadata: {
              image_gen_group_id: "group_1",
              generation_index: 1,
            },
          },
        },
      },
    };

    expect(
      __testing__.imageSelectionAfterMessage(
        JSON.stringify(conversation),
        "request_1"
      )
    ).toEqual({
      messageId: "select_message_1",
      selectedImageMessageId: "choice_message_a",
    });
  });
});
