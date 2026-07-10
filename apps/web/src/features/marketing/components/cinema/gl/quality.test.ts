// 质量调控器:EMA 帧耗时驱动的降/升档,含滞回防抖。
import { describe, expect, it } from "vitest";
import { QualityGovernor } from "./quality";

describe("QualityGovernor", () => {
  it("初始满档", () => {
    expect(new QualityGovernor().tier).toBe(2);
  });

  it("持续慢帧降档,一路降到 0", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 120; i++) g.sample(40);
    expect(g.tier).toBeLessThanOrEqual(1);
    for (let i = 0; i < 240; i++) g.sample(55);
    expect(g.tier).toBe(0);
  });

  it("快帧恢复,但需要滞回窗口(不会单帧反弹)", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 120; i++) g.sample(40);
    const dropped = g.tier;
    g.sample(8);
    expect(g.tier).toBe(dropped); // 单帧不升
    for (let i = 0; i < 300; i++) g.sample(8);
    expect(g.tier).toBeGreaterThan(dropped);
  });

  it("抖动帧(快慢交替)不震荡", () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 400; i++) g.sample(i % 2 === 0 ? 10 : 34);
    // EMA 约 22ms,处于两阈值之间:应稳定停在某一档,而非来回跳
    const t1 = g.tier;
    for (let i = 0; i < 100; i++) g.sample(i % 2 === 0 ? 10 : 34);
    expect(g.tier).toBe(t1);
  });
});
