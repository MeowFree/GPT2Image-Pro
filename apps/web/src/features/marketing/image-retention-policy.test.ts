import { describe, expect, it } from "vitest";

import { formatImageRetentionPolicy } from "./image-retention-policy";

describe("formatImageRetentionPolicy", () => {
  it("shows permanent retention when cleanup is off", () => {
    expect(
      formatImageRetentionPolicy(
        { mode: "off", retentionHours: 72, maxCount: 100 },
        "zh"
      )
    ).toBe("生成图片文件永久保存在画廊中");
  });

  it("shows permanent retention when time mode is configured with zero hours", () => {
    expect(
      formatImageRetentionPolicy(
        { mode: "time", retentionHours: 0, maxCount: 100 },
        "en"
      )
    ).toBe("Generated image files are saved permanently in the gallery");
  });

  it("formats whole days for time retention", () => {
    expect(
      formatImageRetentionPolicy(
        { mode: "time", retentionHours: 72, maxCount: 100 },
        "zh-CN"
      )
    ).toBe("生成图片文件保存 3 天，到期后自动从画廊删除");
  });

  it("keeps non-day durations in hours", () => {
    expect(
      formatImageRetentionPolicy(
        { mode: "time", retentionHours: 25, maxCount: 100 },
        "en-US"
      )
    ).toBe(
      "Generated image files are kept for 25 hours, then automatically removed from the gallery"
    );
  });

  it("does not turn a fractional retention window into permanent storage", () => {
    expect(
      formatImageRetentionPolicy(
        { mode: "time", retentionHours: 0.5, maxCount: 100 },
        "zh-CN"
      )
    ).toBe("生成图片文件保存 0.5 小时，到期后自动从画廊删除");
  });

  it("formats the per-user count limit", () => {
    expect(
      formatImageRetentionPolicy(
        { mode: "count", retentionHours: 0, maxCount: 10_000 },
        "zh-CN"
      )
    ).toBe("每位用户最多保存最新 10,000 张生成图片，超出后自动删除最早图片");
  });

  it("falls back to permanent retention for an invalid count guard", () => {
    expect(
      formatImageRetentionPolicy(
        { mode: "count", retentionHours: 0, maxCount: 0 },
        "en"
      )
    ).toBe("Generated image files are saved permanently in the gallery");
  });
});
