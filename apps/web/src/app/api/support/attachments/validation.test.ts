import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  canReadTicketAttachment,
  MAX_TICKET_IMAGE_BYTES,
  validateTicketImageUpload,
} from "./validation";

describe("validateTicketImageUpload", () => {
  it("derives the trusted type from the image bytes", async () => {
    const bytes = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();
    const result = await validateTicketImageUpload(
      new File([Uint8Array.from(bytes)], "screenshot.jpg", {
        type: "image/jpeg",
      })
    );

    expect(result.contentType).toBe("image/png");
    expect(result.extension).toBe("png");
  });

  it("rejects oversized and invalid files", async () => {
    await expect(
      validateTicketImageUpload(
        new File([new Uint8Array(MAX_TICKET_IMAGE_BYTES + 1)], "large.png")
      )
    ).rejects.toThrow("5MB");
    await expect(
      validateTicketImageUpload(new File(["not an image"], "fake.png"))
    ).rejects.toThrow("图片文件无效");
  });
});

describe("canReadTicketAttachment", () => {
  const attached = {
    uploaderId: "user-1",
    messageId: "message-1",
    ticketUserId: "user-1",
  };

  it("allows the ticket owner and admins to read attached images", () => {
    expect(
      canReadTicketAttachment({
        ...attached,
        sessionUserId: "user-1",
        isAdmin: false,
      })
    ).toBe(true);
    expect(
      canReadTicketAttachment({
        ...attached,
        sessionUserId: "admin-1",
        isAdmin: true,
      })
    ).toBe(true);
  });

  it("denies unrelated users and limits pending images to the uploader", () => {
    expect(
      canReadTicketAttachment({
        ...attached,
        sessionUserId: "user-2",
        isAdmin: false,
      })
    ).toBe(false);
    expect(
      canReadTicketAttachment({
        uploaderId: "user-1",
        messageId: null,
        ticketUserId: null,
        sessionUserId: "user-1",
        isAdmin: false,
      })
    ).toBe(true);
    expect(
      canReadTicketAttachment({
        uploaderId: "user-1",
        messageId: null,
        ticketUserId: null,
        sessionUserId: "user-2",
        isAdmin: false,
      })
    ).toBe(false);
  });
});
