import { describe, expect, it } from "vitest";
import {
  addTicketMessageSchema,
  createTicketSchema,
  MAX_TICKET_ATTACHMENTS,
} from "./ticket";

describe("ticket attachment schemas", () => {
  it("defaults attachment IDs to an empty list", () => {
    const result = createTicketSchema.parse({
      subject: "Image problem",
      category: "technical",
      priority: "medium",
      message: "The generated image has an unexpected artifact.",
    });

    expect(result.attachmentIds).toEqual([]);
  });

  it("limits and deduplicates attachments on replies", () => {
    const ids = Array.from({ length: MAX_TICKET_ATTACHMENTS + 1 }, () =>
      crypto.randomUUID()
    );
    expect(
      addTicketMessageSchema.safeParse({
        ticketId: "ticket-1",
        content: "Screenshot attached",
        attachmentIds: ids,
      }).success
    ).toBe(false);

    const duplicateId = crypto.randomUUID();
    expect(
      addTicketMessageSchema.safeParse({
        ticketId: "ticket-1",
        content: "Screenshot attached",
        attachmentIds: [duplicateId, duplicateId],
      }).success
    ).toBe(false);
  });
});
