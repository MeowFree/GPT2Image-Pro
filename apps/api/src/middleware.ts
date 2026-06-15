import { type NextRequest, NextResponse } from "next/server";

// 纯 API 应用中间件：目前仅透传，限流在后续迭代添加
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/v1/:path*"],
};
