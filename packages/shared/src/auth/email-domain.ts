const ALLOWED_REGISTRATION_EMAIL_DOMAINS = new Set([
  "163.com",
  "126.com",
  "qq.com",
  "gmail.com",
]);

export const ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST = Array.from(
  ALLOWED_REGISTRATION_EMAIL_DOMAINS
);

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const GMAIL_ALIAS_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * 计算用于"注册身份唯一性"判定的规范化邮箱键。
 *
 * 防薅羊毛：同一真实邮箱的别名（Gmail 点号 v.i.c.t.i.m、所有域的 +tag）
 * 会落到同一身份键，从而被唯一约束拦截，避免一个邮箱注册多个账号领取注册奖励。
 *
 * 注意：此值仅用于身份去重，不用于实际收件/展示（那些仍用 normalizeEmail 的原始地址）。
 */
export function canonicalizeEmailForIdentity(email: string) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0) {
    return normalized;
  }

  let local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  // 去除 plus-addressing 标签（对所有域生效）
  const plusIndex = local.indexOf("+");
  if (plusIndex >= 0) {
    local = local.slice(0, plusIndex);
  }

  // Gmail / Googlemail 忽略点号
  if (GMAIL_ALIAS_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
  }

  if (!local) {
    return normalized;
  }

  return `${local}@${domain}`;
}

export function isAllowedRegistrationEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const domain = normalizedEmail.split("@")[1];
  return Boolean(domain && ALLOWED_REGISTRATION_EMAIL_DOMAINS.has(domain));
}

export function getAllowedRegistrationEmailMessage() {
  return `Please use one of these email domains: ${ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST.join(", ")}.`;
}
