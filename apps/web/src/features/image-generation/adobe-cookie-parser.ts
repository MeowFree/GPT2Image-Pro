// 解析批量导入的 Adobe 账号 cookie 文本。
// 用途:管理后台在某个 Adobe 后端(伪账号)下批量导入真实 Adobe 账号时,把一段粘贴
// 文本解析成若干条 cookie 条目。被 image-generation/adobe-direct.ts 的批量导入服务调用。
// 依赖:无(纯函数,不碰 DB/网络),便于单测。
//
// 支持三种粘贴形态(尽量对人省事):
// 1) 每行一个 cookie 字符串。注意 cookie 本身含 `;`/`=`/空格,所以只按换行切分,绝不
//    按这些字符切——否则会把一个 cookie 拆碎。
// 2) JSON 数组:元素是字符串(cookie),或对象 { cookie, name?, scope? }。
// 3) JSON 对象 { cookies: [...] },元素同上。
// 解析时去掉空行、`#` 注释行、行尾逗号与成对的首尾引号,并按 cookie 文本去重(防止同一
// 行被重复粘贴;同一 Adobe 账号但不同 cookie 的去重在服务层按稳定身份做)。

export type AdobeCookieEntry = {
  cookie: string;
  name?: string;
  scope?: string;
};

// 清洗一行:去首尾空白、行尾逗号、成对引号。返回空串表示该行应跳过。
function cleanLine(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  value = value.replace(/,\s*$/, "");
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

// 从未知 JSON 元素抽取一条 cookie 条目(字符串或对象)。抽不到 cookie 返回 null。
function entryFromUnknown(item: unknown): AdobeCookieEntry | null {
  if (typeof item === "string") {
    const cookie = item.trim();
    return cookie ? { cookie } : null;
  }
  if (item && typeof item === "object") {
    const record = item as Record<string, unknown>;
    const cookieRaw =
      record.cookie ?? record.cookieString ?? record.value ?? record.cookies;
    const cookie = typeof cookieRaw === "string" ? cookieRaw.trim() : "";
    if (!cookie) return null;
    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : undefined;
    const scope =
      typeof record.scope === "string" && record.scope.trim()
        ? record.scope.trim()
        : undefined;
    return {
      cookie,
      ...(name ? { name } : {}),
      ...(scope ? { scope } : {}),
    };
  }
  return null;
}

// 按 cookie 文本去重,保序。
function dedupeByCookie(entries: AdobeCookieEntry[]): AdobeCookieEntry[] {
  const seen = new Set<string>();
  const out: AdobeCookieEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.cookie)) continue;
    seen.add(entry.cookie);
    out.push(entry);
  }
  return out;
}

export function parseAdobeCookieEntries(text: string): AdobeCookieEntry[] {
  const trimmed = (text || "").trim();
  if (!trimmed) return [];

  // 先试 JSON(数组 / { cookies: [...] } / 单对象)。
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const container =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).cookies
          : undefined;
      const items: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(container)
          ? container
          : [parsed];
      const entries = items
        .map(entryFromUnknown)
        .filter((entry): entry is AdobeCookieEntry => entry !== null);
      // JSON 解析成功且抽到了 cookie 才采用;否则落回按行解析(可能是别的结构)。
      if (entries.length > 0) return dedupeByCookie(entries);
    } catch {
      // 不是合法 JSON:按行解析(cookie 串里也可能含 {}/[] 字符)。
    }
  }

  const entries: AdobeCookieEntry[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    if (rawLine.trim().startsWith("#")) continue;
    const cookie = cleanLine(rawLine);
    if (cookie) entries.push({ cookie });
  }
  return dedupeByCookie(entries);
}
