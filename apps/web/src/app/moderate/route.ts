import {
  moderateContent,
  type ModerationImageInput,
} from "@repo/shared/moderation";
import { NextResponse, type NextRequest } from "next/server";

type ModerationRequestImage = {
  data?: string;
  name?: string;
  type?: string;
  url?: string;
};

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getProxySecret() {
  return process.env.CONTENT_MODERATION_PROXY_SECRET?.trim();
}

function verifyProxySecret(request: NextRequest) {
  const secret = getProxySecret();
  if (!secret) return true;

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const headerSecret = request.headers.get("x-moderation-proxy-secret") || "";
  return bearer === secret || headerSecret === secret;
}

function parseImage(image: ModerationRequestImage): ModerationImageInput | null {
  if (!image.url && !image.data) return null;
  return {
    data: image.data ? Buffer.from(image.data, "base64") : Buffer.alloc(0),
    name: image.name,
    type: image.type || "image/png",
    url: image.url,
  };
}

export async function POST(request: NextRequest) {
  if (!verifyProxySecret(request)) {
    return errorResponse("Unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    return errorResponse("Invalid request body");
  }

  const input = body as Record<string, unknown>;
  const prompt =
    typeof input.prompt === "string"
      ? input.prompt
      : typeof input.text === "string"
        ? input.text
        : "";
  if (!prompt.trim()) {
    return errorResponse("Missing prompt");
  }

  const images = Array.isArray(input.images)
    ? input.images
        .filter((image): image is ModerationRequestImage => {
          return Boolean(image && typeof image === "object");
        })
        .map(parseImage)
        .filter((image): image is ModerationImageInput => Boolean(image))
    : undefined;

  const mode =
    input.mode === "image" || input.mode === "text" ? input.mode : undefined;

  const result = await moderateContent({
    prompt,
    images,
    mode,
    userId: typeof input.userId === "string" ? input.userId : undefined,
    generationId:
      typeof input.generationId === "string" ? input.generationId : undefined,
    skipProxy: true,
  });

  return NextResponse.json(result);
}
