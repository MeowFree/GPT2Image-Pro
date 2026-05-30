export type GenerationErrorCategory =
  | "platform"
  | "moderation"
  | "user_request";

const USER_REQUEST_PATTERNS = [
  "积分不足",
  "insufficient quota",
  "insufficient_quota",
  "insufficient credits",
  "insufficient_credits",
  "api key quota exceeded",
  "api key credit limit",
  "api_key_quota_exceeded",
  "requires pro plan",
  "requires starter",
  "requires ultra",
  "requires enterprise",
  "invalid model",
  "unsupported model",
  "prompt exceeds",
  "context prompt exceeds",
  "chat input context",
  "invalid quality",
  "invalid moderation",
  "invalid thinking",
  "invalid display size",
  "invalid resolution",
  "use widthxheight",
  "must be between",
  "total pixels",
  "no more than",
  "at least one source image",
  "source images must be",
  "reference images must be",
  "mask must be",
  "is empty",
  "exceeds the",
  "total upload size",
  "upload is too large",
  "invalid or missing api key",
  "unauthorized",
  "account frozen",
];

export const CONTENT_SAFETY_REJECTION_PATTERNS = [
  "content failed moderation",
  "content blocked",
  "content policy",
  "content policy violation",
  "violates our content policy",
  "violates the content policy",
  "policy violation",
  "policy_violation",
  "safety policy",
  "safety system",
  "safety violation",
  "safety_violations",
  "request was rejected by the safety system",
  "rejected by the safety system",
  "blocked by the safety system",
  "flagged by the safety system",
  "flagged by the safety",
  "flagged for sexual content",
  "referenced image was flagged",
  "disallowed content",
  "unsafe content",
  "not allowed to generate",
  "sexualized image",
  "sexually suggestive",
  "explicit sexual",
  "sexual content",
  "未能通过安全",
  "安全系统",
  "露骨",
  "成人性",
  "不能帮助",
  "不能协助",
];

const MODERATION_PATTERNS = [
  "moderation",
  "content moderation",
  ...CONTENT_SAFETY_REJECTION_PATTERNS,
  "aliyun",
  "omni-moderation",
  "risklevel",
];

function includesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

export function isContentSafetyRejection(error: string | null | undefined) {
  const normalized = (error || "").toLowerCase();
  return includesAny(normalized, CONTENT_SAFETY_REJECTION_PATTERNS);
}

export function classifyGenerationError(error: string | null | undefined) {
  const normalized = (error || "").toLowerCase();
  if (includesAny(normalized, MODERATION_PATTERNS)) {
    return "moderation" satisfies GenerationErrorCategory;
  }
  if (includesAny(normalized, USER_REQUEST_PATTERNS)) {
    return "user_request" satisfies GenerationErrorCategory;
  }
  return "platform" satisfies GenerationErrorCategory;
}
