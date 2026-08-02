export const IMAGE_RETENTION_MODES = ["off", "time", "count"] as const;

export type ImageRetentionMode = (typeof IMAGE_RETENTION_MODES)[number];

export interface ImageRetentionPolicy {
  mode: ImageRetentionMode;
  retentionHours: number;
  maxCount: number;
}

function normalizedPositiveNumber(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizedPositiveInteger(value: number) {
  return Math.floor(normalizedPositiveNumber(value));
}

function formatRetentionDuration(hours: number, zh: boolean) {
  const normalizedHours = normalizedPositiveNumber(hours);
  if (normalizedHours % 24 === 0) {
    const days = normalizedHours / 24;
    return zh ? `${days} 天` : `${days} ${days === 1 ? "day" : "days"}`;
  }
  const formattedHours = normalizedHours.toLocaleString(
    zh ? "zh-CN" : "en-US",
    { maximumFractionDigits: 2 }
  );
  return zh
    ? `${formattedHours} 小时`
    : `${formattedHours} ${normalizedHours === 1 ? "hour" : "hours"}`;
}

/** 与图片维护任务一致：无效阈值按不清理处理，避免展示比实际更激进。 */
export function formatImageRetentionPolicy(
  policy: ImageRetentionPolicy,
  locale: string
) {
  const zh = locale.startsWith("zh");
  const retentionHours = normalizedPositiveNumber(policy.retentionHours);
  const maxCount = normalizedPositiveInteger(policy.maxCount);

  if (policy.mode === "time" && retentionHours > 0) {
    const duration = formatRetentionDuration(retentionHours, zh);
    return zh
      ? `生成图片文件保存 ${duration}，到期后自动从画廊删除`
      : `Generated image files are kept for ${duration}, then automatically removed from the gallery`;
  }

  if (policy.mode === "count" && maxCount > 0) {
    return zh
      ? `每位用户最多保存最新 ${maxCount.toLocaleString("zh-CN")} 张生成图片，超出后自动删除最早图片`
      : `Each user can keep their latest ${maxCount.toLocaleString("en-US")} generated images; the oldest are automatically removed when the limit is exceeded`;
  }

  return zh
    ? "生成图片文件永久保存在画廊中"
    : "Generated image files are saved permanently in the gallery";
}
