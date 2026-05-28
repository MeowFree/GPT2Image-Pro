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
