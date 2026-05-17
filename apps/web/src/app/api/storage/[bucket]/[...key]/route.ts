import { db } from "@repo/database";
import { generation } from "@repo/database/schema";
import { auth } from "@repo/shared/auth";
import { getStorageProvider } from "@repo/shared/storage/providers";
import { type NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import path from "node:path";

import { authenticateExternalApiRequest } from "@/features/external-api/auth";

const GENERATIONS_BUCKET =
  process.env.NEXT_PUBLIC_GENERATIONS_BUCKET_NAME || "generations";

const ALLOWED_BUCKETS = new Set([
  process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME || "avatars",
  GENERATIONS_BUCKET,
]);

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function canReadGenerationImage(request: NextRequest, fileKey: string) {
  const apiAuth = await authenticateExternalApiRequest(request);
  if (apiAuth) {
    const ownerPrefix = `${apiAuth.userId}/`;
    if (fileKey.startsWith(ownerPrefix)) return true;
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  });
  const userId = session?.user?.id;
  if (!userId) return false;

  const ownerPrefix = `${userId}/`;
  if (fileKey.startsWith(ownerPrefix)) return true;

  const rows = await db
    .select({ id: generation.id })
    .from(generation)
    .where(
      and(
        eq(generation.userId, userId),
        eq(generation.storageBucket, GENERATIONS_BUCKET),
        eq(generation.storageKey, fileKey)
      )
    )
    .limit(1);

  return Boolean(rows[0]);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bucket: string; key: string[] }> }
) {
  const { bucket, key } = await params;
  const fileKey = key.join("/");

  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: "Bucket not allowed" }, { status: 403 });
  }

  if (
    !fileKey ||
    fileKey.includes("..") ||
    fileKey.startsWith("/") ||
    fileKey.includes("\\")
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  if (
    bucket === GENERATIONS_BUCKET &&
    !(await canReadGenerationImage(request, fileKey))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ext = path.extname(fileKey).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

  try {
    const storage = await getStorageProvider();
    const data = await storage.getObject(fileKey, bucket);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control":
          bucket === GENERATIONS_BUCKET
            ? "private, max-age=300"
            : "public, max-age=3600, immutable",
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
