import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatHistoryMessage } from "../../apps/web/src/features/image-generation/types";

describe("web history image references", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads the latest assistant image for reupload", async () => {
    const {
      downloadWebHistoryImageReference,
      getLatestWebHistoryImageReference,
    } = await import(
      "../../apps/web/src/features/image-generation/web-history-references"
    );

    const history: ChatHistoryMessage[] = [
      {
        role: "user",
        text: "first request",
      },
      {
        role: "assistant",
        text: "text only reply",
        variants: [{ text: "text only reply" }],
      },
      {
        role: "assistant",
        text: "image reply",
        variants: [
          {
            text: "image reply",
            imageUrl: "https://example.com/assistant-reference.png",
          },
        ],
      },
      {
        role: "assistant",
        text: "latest text only reply",
        variants: [{ text: "latest text only reply" }],
      },
    ];

    const reference = getLatestWebHistoryImageReference(history);
    expect(reference).toEqual({
      imageUrl: "https://example.com/assistant-reference.png",
      fileName: "web-history-assistant-3",
      sourceId: "https://example.com/assistant-reference.png",
    });

    const fetchMock = vi.fn(async () => {
      return new Response(Uint8Array.from([1, 2, 3, 4]), {
        headers: {
          "content-type": "image/png",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = await downloadWebHistoryImageReference(reference!);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/assistant-reference.png",
      { signal: undefined }
    );
    expect(file.name).toBe("web-history-assistant-3.png");
    expect(file.type).toBe("image/png");
    expect(file.url).toBe("https://example.com/assistant-reference.png");
    expect([...file.data]).toEqual([1, 2, 3, 4]);
  });

  it("reads local storage history images without a network fetch", async () => {
    const {
      downloadWebHistoryImageReference,
      getLatestWebHistoryImageReference,
    } = await import(
      "../../apps/web/src/features/image-generation/web-history-references"
    );

    const history: ChatHistoryMessage[] = [
      {
        role: "assistant",
        text: "stored image reply",
        variants: [
          {
            text: "stored image reply",
            imageUrl: "/api/storage/generations/user-123/history-image.webp",
          },
        ],
      },
    ];

    const reference = getLatestWebHistoryImageReference(history);
    expect(reference).toEqual({
      imageUrl: "/api/storage/generations/user-123/history-image.webp",
      fileName: "web-history-assistant-1",
      sourceId: "/api/storage/generations/user-123/history-image.webp",
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const readStorageImage = vi.fn(async () => Buffer.from([9, 8, 7]));

    const file = await downloadWebHistoryImageReference(reference!, {
      readStorageImage,
    });

    expect(readStorageImage).toHaveBeenCalledWith({
      bucket: "generations",
      key: "user-123/history-image.webp",
      extension: ".webp",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(file.name).toBe("web-history-assistant-1.webp");
    expect(file.type).toBe("image/webp");
    expect(file.url).toBe("/api/storage/generations/user-123/history-image.webp");
    expect([...file.data]).toEqual([9, 8, 7]);
  });
});
