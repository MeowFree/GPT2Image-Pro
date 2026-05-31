import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import { invokeOperation } from "../invoke";
import { defineOperation, clearRegistry } from "../registry";
import { OperationError } from "../errors";
import type { Principal } from "../principal";
import type { OperationContext } from "../types";

const userPrincipal: Principal = {
  type: "user",
  userId: "u1",
  role: "user",
};

const systemPrincipal: Principal = {
  type: "system",
  reason: "test",
};

/** 注册一个简单的加法操作用于测试 */
function registerAddOp() {
  const inputSchema = z.object({ a: z.number(), b: z.number() });
  const outputSchema = z.object({ sum: z.number() });
  return defineOperation<
    z.infer<typeof inputSchema>,
    z.infer<typeof outputSchema>
  >({
    name: "math.add",
    domain: "credits",
    title: "Add Numbers",
    description: "Adds two numbers",
    input: inputSchema,
    output: outputSchema,
    access: { kind: "public" },
    readOnly: true,
    destructive: false,
    idempotency: { kind: "natural" },
    sideEffects: [],
    execute: async (input) => ({ sum: input.a + input.b }),
  });
}

/** 注册一个需要幂等键的操作 */
function registerIdempotentOp() {
  const inputSchema = z.object({
    amount: z.number(),
    sourceRef: z.string(),
  });
  const outputSchema = z.object({ remaining: z.number() });
  return defineOperation<
    z.infer<typeof inputSchema>,
    z.infer<typeof outputSchema>
  >({
    name: "credits.consume",
    domain: "credits",
    title: "Consume Credits",
    description: "Deduct credits",
    input: inputSchema,
    output: outputSchema,
    access: { kind: "protected" },
    readOnly: false,
    destructive: false,
    idempotency: {
      kind: "required",
      keyField: "sourceRef",
      scope: "per-user",
    },
    sideEffects: ["billing"],
    execute: async (input) => ({ remaining: 100 - input.amount }),
  });
}

describe("UOL Invoke Gateway", () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe("operation lookup", () => {
    it("throws not_found for unknown operation", async () => {
      await expect(
        invokeOperation("nonexistent.op", {}, userPrincipal),
      ).rejects.toThrow(OperationError);

      try {
        await invokeOperation("nonexistent.op", {}, userPrincipal);
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("not_found");
        expect((e as OperationError).httpStatus).toBe(404);
      }
    });
  });

  describe("input validation", () => {
    it("throws validation_error for invalid input", async () => {
      registerAddOp();

      try {
        await invokeOperation(
          "math.add",
          { a: "not-a-number", b: 2 },
          userPrincipal,
        );
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("validation_error");
        expect((e as OperationError).details?.issues).toBeDefined();
      }
    });

    it("passes valid input through to execute", async () => {
      registerAddOp();

      const result = await invokeOperation<{ sum: number }>(
        "math.add",
        { a: 3, b: 4 },
        userPrincipal,
      );
      expect(result.sum).toBe(7);
    });
  });

  describe("idempotency key validation", () => {
    it("throws validation_error when required key is missing", async () => {
      registerIdempotentOp();

      try {
        await invokeOperation(
          "credits.consume",
          { amount: 10 },
          userPrincipal,
        );
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("validation_error");
      }
    });

    it("throws validation_error when required key is empty string", async () => {
      registerIdempotentOp();

      try {
        await invokeOperation(
          "credits.consume",
          { amount: 10, sourceRef: "   " },
          userPrincipal,
        );
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("validation_error");
        expect((e as OperationError).message).toContain("sourceRef");
      }
    });

    it("passes with valid idempotency key", async () => {
      registerIdempotentOp();

      const result = await invokeOperation<{ remaining: number }>(
        "credits.consume",
        { amount: 10, sourceRef: "gen-123" },
        userPrincipal,
      );
      expect(result.remaining).toBe(90);
    });
  });

  describe("access control integration", () => {
    it("rejects forbidden access", async () => {
      defineOperation({
        name: "admin.op",
        domain: "system-settings",
        title: "Admin Op",
        description: "Needs admin",
        input: z.object({}),
        output: z.object({}),
        access: { kind: "admin" },
        readOnly: true,
        destructive: false,
        idempotency: { kind: "natural" },
        sideEffects: [],
        execute: async () => ({}),
      });

      try {
        await invokeOperation("admin.op", {}, userPrincipal);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("forbidden");
      }
    });
  });

  describe("successful execution", () => {
    it("returns operation output", async () => {
      registerAddOp();

      const result = await invokeOperation<{ sum: number }>(
        "math.add",
        { a: 10, b: 20 },
        userPrincipal,
      );
      expect(result).toEqual({ sum: 30 });
    });

    it("provides requestId in context", async () => {
      let capturedCtx: OperationContext | undefined;

      defineOperation({
        name: "ctx.capture",
        domain: "credits",
        title: "Capture Context",
        description: "Captures context for testing",
        input: z.object({}),
        output: z.object({ requestId: z.string() }),
        access: { kind: "public" },
        readOnly: true,
        destructive: false,
        idempotency: { kind: "natural" },
        sideEffects: [],
        execute: async (_input, _principal, ctx) => {
          capturedCtx = ctx;
          return { requestId: ctx.requestId };
        },
      });

      const result = await invokeOperation<{ requestId: string }>(
        "ctx.capture",
        {},
        userPrincipal,
        { requestId: "custom-req-id" },
      );
      expect(result.requestId).toBe("custom-req-id");
      expect(capturedCtx?.requestId).toBe("custom-req-id");
    });

    it("generates requestId when not provided", async () => {
      defineOperation({
        name: "ctx.autoid",
        domain: "credits",
        title: "Auto ID",
        description: "Auto generates request ID",
        input: z.object({}),
        output: z.object({ requestId: z.string() }),
        access: { kind: "public" },
        readOnly: true,
        destructive: false,
        idempotency: { kind: "natural" },
        sideEffects: [],
        execute: async (_input, _principal, ctx) => ({
          requestId: ctx.requestId,
        }),
      });

      const result = await invokeOperation<{ requestId: string }>(
        "ctx.autoid",
        {},
        userPrincipal,
      );
      expect(result.requestId).toBeTruthy();
      expect(typeof result.requestId).toBe("string");
    });
  });

  describe("error handling", () => {
    it("passes through OperationError unchanged", async () => {
      defineOperation({
        name: "err.passthrough",
        domain: "credits",
        title: "Error Passthrough",
        description: "Throws OperationError",
        input: z.object({}),
        output: z.object({}),
        access: { kind: "public" },
        readOnly: false,
        destructive: false,
        idempotency: { kind: "none" },
        sideEffects: [],
        execute: async () => {
          throw new OperationError(
            "quota_exceeded",
            "You have reached your limit",
            { limit: 100 },
          );
        },
      });

      try {
        await invokeOperation("err.passthrough", {}, userPrincipal);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("quota_exceeded");
        expect((e as OperationError).message).toBe(
          "You have reached your limit",
        );
        expect((e as OperationError).details).toEqual({ limit: 100 });
        expect((e as OperationError).httpStatus).toBe(429);
      }
    });

    it("maps insufficient credits domain error", async () => {
      defineOperation({
        name: "err.credits",
        domain: "credits",
        title: "Credits Error",
        description: "Throws credits error",
        input: z.object({}),
        output: z.object({}),
        access: { kind: "public" },
        readOnly: false,
        destructive: false,
        idempotency: { kind: "none" },
        sideEffects: ["billing"],
        execute: async () => {
          throw new Error("Insufficient credits to proceed");
        },
      });

      try {
        await invokeOperation("err.credits", {}, userPrincipal);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("insufficient_credits");
      }
    });

    it("maps account frozen domain error", async () => {
      defineOperation({
        name: "err.frozen",
        domain: "credits",
        title: "Frozen Error",
        description: "Throws frozen error",
        input: z.object({}),
        output: z.object({}),
        access: { kind: "public" },
        readOnly: false,
        destructive: false,
        idempotency: { kind: "none" },
        sideEffects: [],
        execute: async () => {
          throw new Error("Account is frozen");
        },
      });

      try {
        await invokeOperation("err.frozen", {}, userPrincipal);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("account_frozen");
      }
    });

    it("maps rate limit domain error", async () => {
      defineOperation({
        name: "err.ratelimit",
        domain: "external-api",
        title: "Rate Limit Error",
        description: "Throws rate limit error",
        input: z.object({}),
        output: z.object({}),
        access: { kind: "public" },
        readOnly: false,
        destructive: false,
        idempotency: { kind: "none" },
        sideEffects: [],
        execute: async () => {
          throw new Error("Rate limit exceeded");
        },
      });

      try {
        await invokeOperation("err.ratelimit", {}, userPrincipal);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("rate_limited");
      }
    });

    it("wraps unknown errors as internal_error", async () => {
      defineOperation({
        name: "err.unknown",
        domain: "credits",
        title: "Unknown Error",
        description: "Throws unknown error",
        input: z.object({}),
        output: z.object({}),
        access: { kind: "public" },
        readOnly: false,
        destructive: false,
        idempotency: { kind: "none" },
        sideEffects: [],
        execute: async () => {
          throw new Error("Something unexpected broke");
        },
      });

      try {
        await invokeOperation("err.unknown", {}, userPrincipal);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("internal_error");
        // 不泄露内部错误细节
        expect((e as OperationError).message).toBe(
          "An unexpected error occurred",
        );
        expect((e as OperationError).httpStatus).toBe(500);
      }
    });
  });

  describe("ownership assertion", () => {
    it("ctx.assertOwnership passes for matching userId", async () => {
      defineOperation({
        name: "owner.pass",
        domain: "storage",
        title: "Owner Pass",
        description: "Tests ownership pass",
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        access: { kind: "owner", resource: "file" },
        readOnly: true,
        destructive: false,
        idempotency: { kind: "natural" },
        sideEffects: [],
        execute: async (_input, _principal, ctx) => {
          ctx.assertOwnership("file", "u1");
          return { ok: true };
        },
      });

      const result = await invokeOperation<{ ok: boolean }>(
        "owner.pass",
        {},
        userPrincipal,
      );
      expect(result.ok).toBe(true);
    });

    it("ctx.assertOwnership throws for non-matching userId", async () => {
      defineOperation({
        name: "owner.fail",
        domain: "storage",
        title: "Owner Fail",
        description: "Tests ownership fail",
        input: z.object({}),
        output: z.object({}),
        access: { kind: "owner", resource: "file" },
        readOnly: true,
        destructive: false,
        idempotency: { kind: "natural" },
        sideEffects: [],
        execute: async (_input, _principal, ctx) => {
          ctx.assertOwnership("file", "other-user");
          return {};
        },
      });

      try {
        await invokeOperation("owner.fail", {}, userPrincipal);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError);
        expect((e as OperationError).code).toBe("ownership_violation");
      }
    });

    it("ctx.assertOwnership bypassed for system principal", async () => {
      defineOperation({
        name: "owner.system",
        domain: "storage",
        title: "Owner System",
        description: "Tests system bypass",
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        access: { kind: "owner", resource: "file" },
        readOnly: true,
        destructive: false,
        idempotency: { kind: "natural" },
        sideEffects: [],
        execute: async (_input, _principal, ctx) => {
          // system principal 不关心 ownerId
          ctx.assertOwnership("file", "any-user");
          return { ok: true };
        },
      });

      const result = await invokeOperation<{ ok: boolean }>(
        "owner.system",
        {},
        systemPrincipal,
      );
      expect(result.ok).toBe(true);
    });
  });
});
