/**
 * 分层产物元数据解析的单测(纯函数,不依赖 DB/重模型)。
 * 覆盖:正常分层、非分层、缺字段、角色非法等边界。
 */
import { describe, expect, it } from "vitest";
import { hasLayeredMeta, readLayeredMeta } from "./layered-meta";

const validLayered = {
  outputImage: {
    layered: {
      version: 1,
      layers: [
        { storageKey: "u/c.png", role: "composite", order: 0, size: "1x1" },
        { storageKey: "u/bg.png", role: "background", order: 1 },
        { storageKey: "u/e1.png", role: "element", order: 2 },
      ],
    },
  },
};

describe("readLayeredMeta", () => {
  it("解析合法分层元数据", () => {
    const parsed = readLayeredMeta(validLayered);
    expect(parsed).not.toBeNull();
    expect(parsed?.layers).toHaveLength(3);
    expect(parsed?.layers[0]?.role).toBe("composite");
  });

  it("非分层(无 layered 键)返回 null", () => {
    expect(readLayeredMeta({ outputImage: {} })).toBeNull();
    expect(readLayeredMeta({})).toBeNull();
  });

  it("非对象/空值返回 null", () => {
    expect(readLayeredMeta(null)).toBeNull();
    expect(readLayeredMeta(undefined)).toBeNull();
    expect(readLayeredMeta("x")).toBeNull();
  });

  it("layers 为空数组判为非法", () => {
    expect(
      readLayeredMeta({ outputImage: { layered: { layers: [] } } })
    ).toBeNull();
  });

  it("角色非法判为非法", () => {
    expect(
      readLayeredMeta({
        outputImage: {
          layered: { layers: [{ storageKey: "a", role: "foo", order: 0 }] },
        },
      })
    ).toBeNull();
  });

  it("缺 storageKey 判为非法", () => {
    expect(
      readLayeredMeta({
        outputImage: {
          layered: { layers: [{ role: "background", order: 0 }] },
        },
      })
    ).toBeNull();
  });
});

describe("hasLayeredMeta", () => {
  it("合法分层为 true,其余为 false", () => {
    expect(hasLayeredMeta(validLayered)).toBe(true);
    expect(hasLayeredMeta({})).toBe(false);
    expect(hasLayeredMeta(null)).toBe(false);
  });
});
