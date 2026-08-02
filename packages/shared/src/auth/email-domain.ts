export const ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST = [
  "163.com",
  "126.com",
  "qq.com",
  "gmail.com",
] as const;

export interface RegistrationEmailPolicy {
  allowedDomains: string[];
  blockPlusAliases: boolean;
  blockDottedLocalParts: boolean;
}

export type RegistrationEmailRejectionReason =
  | "domain_not_allowed"
  | "plus_alias_not_allowed"
  | "dotted_local_part_not_allowed";

export type RegistrationEmailErrorCode =
  | "EMAIL_DOMAIN_NOT_ALLOWED"
  | "EMAIL_PLUS_ALIAS_NOT_ALLOWED"
  | "EMAIL_DOTTED_LOCAL_PART_NOT_ALLOWED";

export const DEFAULT_REGISTRATION_EMAIL_POLICY: RegistrationEmailPolicy = {
  allowedDomains: [...ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST],
  blockPlusAliases: false,
  blockDottedLocalParts: false,
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function parseRegistrationEmailDomains(value?: string | null) {
  if (value === undefined || value === null) {
    return [...ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST];
  }

  const domains = Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
        .filter(
          (domain) =>
            domain.includes(".") &&
            /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)
        )
    )
  );
  return domains.length > 0
    ? domains
    : [...ALLOWED_REGISTRATION_EMAIL_DOMAIN_LIST];
}

function splitEmail(email: string) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return null;
  }
  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (localPart.includes("@") || domain.includes("@")) {
    return null;
  }
  return {
    localPart,
    domain,
  };
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

export function getRegistrationEmailRejectionReason(
  email: string,
  policy: RegistrationEmailPolicy = DEFAULT_REGISTRATION_EMAIL_POLICY
): RegistrationEmailRejectionReason | null {
  const parts = splitEmail(email);
  const allowedDomains = new Set(
    policy.allowedDomains.map((domain) => domain.trim().toLowerCase())
  );

  if (!parts || !allowedDomains.has(parts.domain)) {
    return "domain_not_allowed";
  }
  if (policy.blockPlusAliases && parts.localPart.includes("+")) {
    return "plus_alias_not_allowed";
  }
  if (policy.blockDottedLocalParts && parts.localPart.includes(".")) {
    return "dotted_local_part_not_allowed";
  }
  return null;
}

export function isAllowedRegistrationEmail(
  email: string,
  policy: RegistrationEmailPolicy = DEFAULT_REGISTRATION_EMAIL_POLICY
) {
  return getRegistrationEmailRejectionReason(email, policy) === null;
}

export function getRegistrationEmailRejectionMessage(
  reason: RegistrationEmailRejectionReason,
  policy: RegistrationEmailPolicy = DEFAULT_REGISTRATION_EMAIL_POLICY
) {
  if (reason === "plus_alias_not_allowed") {
    return "Email aliases containing + are not allowed.";
  }
  if (reason === "dotted_local_part_not_allowed") {
    return "Email usernames containing . are not allowed.";
  }
  return `Please use one of these email domains: ${policy.allowedDomains.join(", ")}.`;
}

export function getRegistrationEmailErrorCode(
  reason: RegistrationEmailRejectionReason
): RegistrationEmailErrorCode {
  if (reason === "plus_alias_not_allowed") {
    return "EMAIL_PLUS_ALIAS_NOT_ALLOWED";
  }
  if (reason === "dotted_local_part_not_allowed") {
    return "EMAIL_DOTTED_LOCAL_PART_NOT_ALLOWED";
  }
  return "EMAIL_DOMAIN_NOT_ALLOWED";
}
