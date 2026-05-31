/**
 * generation-metadata 模块的单测
 *
 * 覆盖输入图片元数据构建和提取。
 * 签名 URL 包含时间戳，因此只验证 URL 前缀和签名参数格式。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildInputImagesMetadata,
  extractGenerationReferenceImages,
} from "./generation-metadata";

const TEST_SECRET = "test-secret-for-generation-metadata-tests";

describe("generation metadata image references", () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = originalSecret;
    }
  });

  it("stores uploaded input images with signed storage URLs", () => {
    const metadata = buildInputImagesMetadata([
      {
        data: Buffer.from("image"),
        name: "reference.png",
        type: "image/png",
        url: "https://signed.example/reference.png",
        storageBucket: "generations",
        storageKey: "user/requests/reference.png",
      },
    ]);

    const images = metadata.inputImages.images;
    expect(images).toHaveLength(1);
    const image = images[0]!;
    expect(image.id).toBe("input-1");
    // URL 包含签名参数
    expect(image.imageUrl).toMatch(
      /^\/api\/storage\/generations\/user\/requests\/reference\.png\?sig=[0-9a-f]{64}&exp=\d+$/
    );
    expect(image.storageBucket).toBe("generations");
    expect(image.storageKey).toBe("user/requests/reference.png");
    expect(image.name).toBe("reference.png");
    expect(image.type).toBe("image/png");
    expect(image.sizeBytes).toBe(5);
    expect(image.source).toBe("upload");
    expect(image.role).toBe("reference");
    expect(image.index).toBe(0);
  });

  it("extracts reference images from metadata and prefers signed stored object URLs", () => {
    const result = extractGenerationReferenceImages({
      inputImages: {
        images: [
          {
            id: "input-1",
            imageUrl: "https://signed.example/old.png",
            storageBucket: "generations",
            storageKey: "user/requests/reference.png",
            name: "reference.png",
            type: "image/png",
            sizeBytes: 123,
            source: "upload",
            role: "reference",
            index: 0,
          },
        ],
      },
    });

    expect(result).toHaveLength(1);
    const image = result[0]!;
    expect(image.id).toBe("input-1");
    // 提取时应使用带签名的存储 URL（优先于 metadata 中记录的旧 imageUrl）
    expect(image.imageUrl).toMatch(
      /^\/api\/storage\/generations\/user\/requests\/reference\.png\?sig=[0-9a-f]{64}&exp=\d+$/
    );
    expect(image.storageBucket).toBe("generations");
    expect(image.storageKey).toBe("user/requests/reference.png");
    expect(image.name).toBe("reference.png");
    expect(image.type).toBe("image/png");
    expect(image.sizeBytes).toBe(123);
    expect(image.source).toBe("upload");
    expect(image.role).toBe("reference");
    expect(image.index).toBe(0);
  });
});
