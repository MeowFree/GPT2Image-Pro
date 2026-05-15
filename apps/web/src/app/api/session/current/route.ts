import { auth } from "@repo/shared/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

function withNoStore(response: NextResponse) {
  response.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, max-age=0, must-revalidate"
  );
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return withNoStore(NextResponse.json(session ?? null));
}
