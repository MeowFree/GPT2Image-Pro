import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";
import { withApiLogging } from "@repo/shared/api-logger";
import { auth } from "@repo/shared/auth";
import { getFileTypeFromName, type SupportedFileType } from "@/lib/file-utils";

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
 * 允许的文件类型和大小限制
 */
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".doc", ".md", ".txt"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 服务端派生的安全 Content-Type（不信任客户端传入的 contentType，
 * 防止上传方将文档声明为 text/html 等导致存储源上的存储型 XSS）。
 */
const SAFE_CONTENT_TYPES: Record<SupportedFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  txt: "text/plain",
};

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
    const { filename, fileSize } = body as {
      filename: string;
      contentType?: string;
      fileSize: number;
    };

    // 验证文件名
    if (!filename) {
      return NextResponse.json(
        { error: "Filename is required" },
        { status: 400 }
      );
    }

    // 验证文件类型
    const fileType = getFileTypeFromName(filename);
    if (!fileType) {
      return NextResponse.json(
        {
          error: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // 验证文件大小（严格：必须是有限正数且不超过上限；缺失/非法一律拒绝）
    if (
      typeof fileSize !== "number" ||
      !Number.isFinite(fileSize) ||
      fileSize <= 0 ||
      fileSize > MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          error: `Invalid file size. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        },
        { status: 400 }
      );
    }

    // 生成唯一的文件 key
    const fileExtension = filename.match(/\.[^.]+$/)?.[0] || "";
    const fileKey = `uploads/${session.user.id}/${nanoid()}${fileExtension}`;

    // 服务端派生 Content-Type（忽略客户端声明），并签入预签名请求。
    const safeContentType = SAFE_CONTENT_TYPES[fileType];

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
