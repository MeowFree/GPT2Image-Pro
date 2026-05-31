import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import {
  defineOperation,
  getOperation,
  listOperations,
  getRegistrySize,
  clearRegistry,
} from "../registry";
import type { OperationDefinition } from "../types";

/** 测试用最小操作定义工厂 */
function makeTestOp(
  overrides: Partial<OperationDefinition> = {},
): OperationDefinition {
  return {
    name: overrides.name ?? "test.op",
    domain: overrides.domain ?? "credits",
    title: "Test Operation",
    description: "A test operation",
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    access: { kind: "public" },
    readOnly: overrides.readOnly ?? false,
    destructive: overrides.destructive ?? false,
    idempotency: { kind: "natural" },
    sideEffects: [],
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("UOL Registry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe("defineOperation", () => {
    it("registers and retrieves an operation", () => {
      const op = makeTestOp({ name: "credits.balance" });
      const result = defineOperation(op);

      expect(result).toBe(op);
      expect(getOperation("credits.balance")).toBe(op);
    });

    it("throws on duplicate name registration", () => {
      defineOperation(makeTestOp({ name: "dup.op" }));

      expect(() => defineOperation(makeTestOp({ name: "dup.op" }))).toThrow(
        "[UOL] Duplicate operation registration: dup.op",
      );
    });
  });

  describe("getOperation", () => {
    it("returns undefined for unknown operation name", () => {
      expect(getOperation("nonexistent.op")).toBeUndefined();
    });

    it("returns the registered operation", () => {
      const op = makeTestOp({ name: "found.op" });
      defineOperation(op);
      expect(getOperation("found.op")).toBe(op);
    });
  });

  describe("listOperations", () => {
    it("returns all operations when no filter", () => {
      defineOperation(makeTestOp({ name: "op1" }));
      defineOperation(makeTestOp({ name: "op2" }));
      defineOperation(makeTestOp({ name: "op3" }));

      expect(listOperations()).toHaveLength(3);
    });

    it("filters by domain", () => {
      defineOperation(makeTestOp({ name: "op.a", domain: "credits" }));
      defineOperation(
        makeTestOp({ name: "op.b", domain: "image-generation" }),
      );
      defineOperation(makeTestOp({ name: "op.c", domain: "credits" }));

      const filtered = listOperations({ domain: "credits" });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((op) => op.domain === "credits")).toBe(true);
    });

    it("filters by readOnly", () => {
      defineOperation(makeTestOp({ name: "ro", readOnly: true }));
      defineOperation(makeTestOp({ name: "rw", readOnly: false }));

      expect(listOperations({ readOnly: true })).toHaveLength(1);
      expect(listOperations({ readOnly: true })[0]?.name).toBe("ro");
      expect(listOperations({ readOnly: false })).toHaveLength(1);
      expect(listOperations({ readOnly: false })[0]?.name).toBe("rw");
    });

    it("filters by destructive", () => {
      defineOperation(makeTestOp({ name: "safe", destructive: false }));
      defineOperation(
        makeTestOp({ name: "danger", destructive: true }),
      );

      expect(listOperations({ destructive: true })).toHaveLength(1);
      expect(listOperations({ destructive: true })[0]?.name).toBe(
        "danger",
      );
    });

    it("combines multiple filter criteria", () => {
      defineOperation(
        makeTestOp({
          name: "match",
          domain: "credits",
          readOnly: true,
          destructive: false,
        }),
      );
      defineOperation(
        makeTestOp({
          name: "no-match-domain",
          domain: "storage",
          readOnly: true,
          destructive: false,
        }),
      );
      defineOperation(
        makeTestOp({
          name: "no-match-rw",
          domain: "credits",
          readOnly: false,
          destructive: false,
        }),
      );

      const filtered = listOperations({
        domain: "credits",
        readOnly: true,
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.name).toBe("match");
    });
  });

  describe("getRegistrySize", () => {
    it("returns 0 for empty registry", () => {
      expect(getRegistrySize()).toBe(0);
    });

    it("returns correct count after registrations", () => {
      defineOperation(makeTestOp({ name: "a" }));
      defineOperation(makeTestOp({ name: "b" }));
      expect(getRegistrySize()).toBe(2);
    });
  });

  describe("clearRegistry", () => {
    it("empties all registered operations", () => {
      defineOperation(makeTestOp({ name: "x" }));
      defineOperation(makeTestOp({ name: "y" }));
      expect(getRegistrySize()).toBe(2);

      clearRegistry();
      expect(getRegistrySize()).toBe(0);
      expect(getOperation("x")).toBeUndefined();
      expect(getOperation("y")).toBeUndefined();
    });
  });
});
