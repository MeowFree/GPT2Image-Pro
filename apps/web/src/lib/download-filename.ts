/**
 * 下载文件名生成工具（纯函数，确定性输出）。
 *
 * 格式: gpt2image_<prompt 哈希 8 位>_T<YYYY_MM_DD>d<HH_mm_ss>.<扩展名>
 * 示例: gpt2image_a3f2b1c0_T2026_06_19d14_30_52.png
 *
 * 哈希用于区分不同 prompt，方便用户在本地按 prompt 整理文件；
 * 时间戳（UTC）保证同一 prompt 多次生成不会覆盖。
 * 相同 (prompt, createdAt) 输入永远产出同一文件名，与下载时间/时区无关。
 */

/**
 * DJB2 哈希:轻量、纯字符串输入、冲突率足够低（仅用于文件名区分，非安全场景）。
 * 输出 base36 字符串，取前 length 位。
 */
function promptHash(prompt: string, length: number): string {
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(length, "0").slice(0, length);
}

/**
 * ISO 时间字符串 -> T<YYYY_MM_DD>d<HH_mm_ss> 格式（UTC，确保跨时区确定性）。
 * 解析失败时回退到原始字符串的 sanitize 版本。
 */
function formatCompactTime(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    return isoString.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}_${pad(d.getUTCMonth() + 1)}_${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}_${pad(d.getUTCMinutes())}_${pad(d.getUTCSeconds())}`;
  return `T${date}d${time}`;
}

/**
 * 生成 GPT2Image 标准下载文件名。
 *
 * @param prompt    - 生成时使用的提示词
 * @param createdAt - 生成时间 ISO 字符串
 * @param extension - 文件扩展名（不带点），默认 "png"
 * @returns 格式化文件名，如 gpt2image_a3f2b1c0_T2026_06_19d14_30_52.png
 */
export function generateDownloadFilename(
  prompt: string,
  createdAt: string,
  extension = "png"
): string {
  const hash = promptHash(prompt, 8);
  const time = formatCompactTime(createdAt);
  return `gpt2image_${hash}_${time}.${extension}`;
}
