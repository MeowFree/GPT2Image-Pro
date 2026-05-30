import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { validateUploadRequest } from "./validation";

/**
 * S3/R2 客户端配置
 */
const s3Client = new S3Client({
  region: process.env.STORAGE_REGION || "auto",
  ...(process.env.STORAGE_ENDPOINT && {
    endpoint: process.env.STORAGE_ENDPOINT,
  }),
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME || "gpt2image-uploads";

/**
 * 获取预签名上传 URL
 *
 * POST /api/upload/presigned
 * Body: { filename: string, contentType: string, fileSize: number }
 */
export const POST = withApiLogging(async (request: NextRequest) => {
  try {
    // 验证用户登录
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { filename } = body as { filename: string };

    // 校验文件名、文件类型与大小（纯逻辑在 validation.ts，便于单测）。
    // 失败时返回 400；成功时拿到服务端派生的安全 Content-Type。
    const validation = validateUploadRequest(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { safeContentType } = validation;

    // 生成唯一的文件 key
    const fileExtension = filename.match(/\.[^.]+$/)?.[0] || "";
    const fileKey = `uploads/${session.user.id}/${nanoid()}${fileExtension}`;

    // 创建预签名 URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ContentType: safeContentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    // 构建文件访问 URL
    const fileUrl = `${process.env.STORAGE_ENDPOINT}/${BUCKET_NAME}/${fileKey}`;

    return NextResponse.json({
      presignedUrl,
      fileKey,
      fileUrl,
      contentType: safeContentType,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error("Error creating presigned URL:", error);
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
});
