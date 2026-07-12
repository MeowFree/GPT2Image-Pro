/**
 * 册页序号:谷段问答体/例言体共用的传统序号(FAQ 册页与计费例言)。
 * 中文用汉字序数(超出回退阿拉伯),英文用两位补零——排版记号,
 * 不入 i18n。
 */
export const ZH_NUMERALS = [
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
] as const;

export function folioNumeral(index: number, zh: boolean): string {
  if (zh) return ZH_NUMERALS[index] ?? String(index + 1);
  return String(index + 1).padStart(2, "0");
}
