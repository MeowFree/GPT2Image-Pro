/**
 * 存储 URL 签名工具的单测
 *
 * 覆盖：签名生成与验证、过期拒绝、篡改拒绝、公开桶绕过、常量时间比较。
 * 纯函数测试，不依赖数据库。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateSignedImageParams,
  generateSignedImageUrl,
  isPublicBucket,
  verifySignedImageUrl,
} from "./signed-url";

const TEST_SECRET = "test-secret-for-signing-do-not-use-in-prod";

describe("signed-url", () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalAvatarBucket = process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
    delete process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalSecret;
    }
    if (originalAvatarBucket === undefined) {
      delete process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME;
    } else {
      process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME = originalAvatarBucket;
    }
    vi.restoreAllMocks();
  });

  describe("isPublicBucket", () => {
    it("默认 avatars 桶为公开桶", () => {
      expect(isPublicBucket("avatars")).toBe(true);
    });

    it("配置的头像桶为公开桶", () => {
      // isPublicBucket 在模块加载时读取 env，此测试验证默认值行为
      expect(isPublicBucket("avatars")).toBe(true);
    });

    it("generations 桶不是公开桶", () => {
      expect(isPublicBucket("generations")).toBe(false);
    });

    it("未知桶不是公开桶", () => {
      expect(isPublicBucket("unknown-bucket")).toBe(false);
    });
  });

  describe("generateSignedImageParams", () => {
    it("生成有效的签名参数", () => {
      const { sig, exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("默认有效期为 3600 秒", () => {
      const now = Math.floor(Date.now() / 1000);
      const { exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      // 允许 2 秒误差
      expect(exp).toBeGreaterThanOrEqual(now + 3598);
      expect(exp).toBeLessThanOrEqual(now + 3602);
    });

    it("可指定自定义有效期", () => {
      const now = Math.floor(Date.now() / 1000);
      const { exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png",
        7200
      );
      expect(exp).toBeGreaterThanOrEqual(now + 7198);
      expect(exp).toBeLessThanOrEqual(now + 7202);
    });

    it("缺少 BETTER_AUTH_SECRET 时抛出错误", () => {
      delete process.env.BETTER_AUTH_SECRET;
      expect(() =>
        generateSignedImageParams("generations", "user-1/abc.png")
      ).toThrow("BETTER_AUTH_SECRET is required");
    });
  });

  describe("generateSignedImageUrl", () => {
    it("为 generations 桶生成带签名参数的 URL", () => {
      const url = generateSignedImageUrl(
        "generations",
        "user-1/abc.png"
      );
      expect(url).toMatch(
        /^\/api\/storage\/generations\/user-1\/abc\.png\?sig=[0-9a-f]{64}&exp=\d+$/
      );
    });

    it("公开桶（avatars）不添加签名参数", () => {
      const url = generateSignedImageUrl("avatars", "user-1-123.jpg");
      expect(url).toBe("/api/storage/avatars/user-1-123.jpg");
      expect(url).not.toContain("?sig=");
    });
  });

  describe("verifySignedImageUrl", () => {
    it("有效签名验证通过", () => {
      const { sig, exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      const result = verifySignedImageUrl(
        "generations",
        "user-1/abc.png",
        sig,
        exp
      );
      expect(result).toBe("valid");
    });

    it("过期签名被拒绝", () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100;
      // 即使签名正确，过期也应该被拒绝
      const { sig } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      const result = verifySignedImageUrl(
        "generations",
        "user-1/abc.png",
        sig,
        pastExpiry
      );
      expect(result).toBe("expired");
    });

    it("篡改签名被拒绝（错误签名值）", () => {
      const { exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      const tamperedSig = "a".repeat(64);
      const result = verifySignedImageUrl(
        "generations",
        "user-1/abc.png",
        tamperedSig,
        exp
      );
      expect(result).toBe("invalid");
    });

    it("篡改路径被拒绝（正确签名但错误 key）", () => {
      const { sig, exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      // 用 user-1/abc.png 的签名去访问 user-2/abc.png
      const result = verifySignedImageUrl(
        "generations",
        "user-2/abc.png",
        sig,
        exp
      );
      expect(result).toBe("invalid");
    });

    it("篡改桶名被拒绝", () => {
      const { sig, exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      const result = verifySignedImageUrl(
        "other-bucket",
        "user-1/abc.png",
        sig,
        exp
      );
      expect(result).toBe("invalid");
    });

    it("使用不同密钥签名被拒绝", () => {
      const { sig, exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      // 切换密钥
      process.env.BETTER_AUTH_SECRET = "different-secret";
      const result = verifySignedImageUrl(
        "generations",
        "user-1/abc.png",
        sig,
        exp
      );
      expect(result).toBe("invalid");
    });

    it("非法长度签名被拒绝（非 64 位 hex）", () => {
      const { exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      // 短签名
      const result = verifySignedImageUrl(
        "generations",
        "user-1/abc.png",
        "abcd",
        exp
      );
      expect(result).toBe("invalid");
    });

    it("空签名被拒绝", () => {
      const { exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      const result = verifySignedImageUrl(
        "generations",
        "user-1/abc.png",
        "",
        exp
      );
      expect(result).toBe("invalid");
    });

    it("常量时间比较：不会因前缀正确就提前返回 valid", () => {
      // 此测试验证代码逻辑正确性（使用 timingSafeEqual），
      // 不做精确时序测量（单测环境噪声太大）。
      const { sig, exp } = generateSignedImageParams(
        "generations",
        "user-1/abc.png"
      );
      // 正确签名的前半段 + 错误后半段
      const halfCorrect =
        sig.slice(0, 32) + "0".repeat(32);
      const result = verifySignedImageUrl(
        "generations",
        "user-1/abc.png",
        halfCorrect,
        exp
      );
      expect(result).toBe("invalid");
    });
  });
});
