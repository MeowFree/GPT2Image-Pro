/**
 * 固定注册邀请码纯逻辑单测。
 *
 * 覆盖部署配置边界和恒定时间摘要比较，测试不读取数据库或真实环境变量。
 */
import { describe, expect, it } from "vitest";

import {
  REGISTRATION_FIXED_CODE_MAX_LENGTH,
  REGISTRATION_FIXED_CODE_MIN_LENGTH,
  matchesRegistrationFixedCode,
  normalizeRegistrationFixedCode,
} from "./registration-fixed-code-core";

describe("normalizeRegistrationFixedCode", () => {
  it("未配置或仅有空白时关闭固定邀请码模式", () => {
    expect(normalizeRegistrationFixedCode(undefined)).toBeNull();
    expect(normalizeRegistrationFixedCode(null)).toBeNull();
    expect(normalizeRegistrationFixedCode("   ")).toBeNull();
  });

  it("返回去除首尾空白后的合法邀请码", () => {
    expect(normalizeRegistrationFixedCode("  invite-2026  ")).toBe(
      "invite-2026"
    );
  });

  it("拒绝过短或过长的邀请码配置", () => {
    expect(() =>
      normalizeRegistrationFixedCode(
        "x".repeat(REGISTRATION_FIXED_CODE_MIN_LENGTH - 1)
      )
    ).toThrow();
    expect(() =>
      normalizeRegistrationFixedCode(
        "x".repeat(REGISTRATION_FIXED_CODE_MAX_LENGTH + 1)
      )
    ).toThrow();
  });
});

describe("matchesRegistrationFixedCode", () => {
  it("接受完全一致的邀请码并忽略用户输入首尾空白", () => {
    expect(matchesRegistrationFixedCode("invite-2026", " invite-2026 ")).toBe(
      true
    );
  });

  it("拒绝内容或大小写不同的邀请码", () => {
    expect(matchesRegistrationFixedCode("invite-2026", "invite-2025")).toBe(
      false
    );
    expect(matchesRegistrationFixedCode("invite-2026", "INVITE-2026")).toBe(
      false
    );
  });
});
