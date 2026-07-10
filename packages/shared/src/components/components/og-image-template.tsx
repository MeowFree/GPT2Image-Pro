import { ImageResponse } from "next/og";

import { siteConfig } from "../../config";

/**
 * OG 图片尺寸配置
 */
export const OG_IMAGE_SIZE = {
  width: 1200,
  height: 630,
};

/**
 * 从 URL 提取主机名
 */
function getHostname(url: string | undefined): string {
  if (!url) return "example.com";
  try {
    return new URL(url).hostname;
  } catch {
    const cleaned = url.replace(/^https?:\/\//, "");
    return cleaned.split("/")[0] ?? cleaned;
  }
}

/**
 * 创建 OG 图片响应
 *
 * 共享的图片生成逻辑，用于 Open Graph 和 Twitter 卡片
 *
 * 功能:
 * - 显示站点名称和描述
 * - 品牌单色配色(GPT2IMAGE 黑白体系,暖调深底 + Georgia 衬线标题)
 * - 动态显示站点 URL
 */
export function createOgImageResponse(): ImageResponse {
  const hostname = getHostname(siteConfig.url);

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1a1a1a",
        backgroundImage:
          "radial-gradient(circle at 25% 25%, rgba(255,255,255,0.05) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(255,255,255,0.03) 0%, transparent 50%)",
      }}
    >
      {/* Logo / Brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 40,
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            background: "#ffffff",
            borderRadius: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 24,
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1a1a1a"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span
          style={{
            fontSize: 64,
            fontWeight: 500,
            fontFamily: "Georgia, serif",
            color: "#f5f5f5",
          }}
        >
          {siteConfig.name}
        </span>
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: 28,
          color: "#b0b0b0",
          textAlign: "center",
          maxWidth: 800,
          lineHeight: 1.4,
          padding: "0 40px",
        }}
      >
        {siteConfig.description}
      </div>

      {/* URL Badge */}
      <div
        style={{
          marginTop: 48,
          display: "flex",
          alignItems: "center",
          padding: "12px 24px",
          background: "rgba(255, 255, 255, 0.06)",
          borderRadius: 50,
          border: "1px solid rgba(255, 255, 255, 0.18)",
        }}
      >
        <span
          style={{
            fontSize: 18,
            color: "#d4d4d4",
          }}
        >
          {hostname}
        </span>
      </div>
    </div>,
    {
      ...OG_IMAGE_SIZE,
    }
  );
}
