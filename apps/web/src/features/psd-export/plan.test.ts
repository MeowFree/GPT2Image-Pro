import { describe, expect, it } from "vitest";
import {
  MAX_PSD_EXTRA_LAYERS,
  type PsdElementSpec,
  planPsdLayers,
} from "./plan";

describe("planPsdLayers", () => {
  it("仅底图时返回单个 background 层", () => {
    expect(planPsdLayers({})).toEqual([{ role: "background", name: "background" }]);
  });

  it("抠主体 + 多个元素:顺序底层在前,角色与提示词正确", () => {
    const jobs = planPsdLayers({
      isolateSubject: true,
      elements: [
        { prompt: "a red apple" },
        { name: "logo", prompt: "a blue logo" },
      ],
    });
    expect(jobs).toEqual([
      { role: "background", name: "background" },
      { role: "subject", name: "subject" },
      { role: "element", name: "element-1", prompt: "a red apple" },
      { role: "element", name: "logo", prompt: "a blue logo" },
    ]);
  });

  it("层名冲突时自动加后缀去重", () => {
    const jobs = planPsdLayers({
      elements: [
        { name: "star", prompt: "p1" },
        { name: "star", prompt: "p2" },
        { name: "subject", prompt: "p3" },
      ],
      isolateSubject: true,
    });
    const names = jobs.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("star");
    expect(names).toContain("star-2");
    // 与保留的 subject 层冲突的元素名被改写
    expect(names.filter((n) => n.startsWith("subject"))).toEqual([
      "subject",
      "subject-2",
    ]);
  });

  it("元素提示词为空抛错", () => {
    expect(() => planPsdLayers({ elements: [{ prompt: "  " }] })).toThrow(
      "描述不能为空"
    );
  });

  it("附加图层超过上限抛错", () => {
    const elements: PsdElementSpec[] = Array.from(
      { length: MAX_PSD_EXTRA_LAYERS + 1 },
      (_, i) => ({ prompt: `p${i}` })
    );
    expect(() => planPsdLayers({ elements })).toThrow("不能超过");
  });
});
