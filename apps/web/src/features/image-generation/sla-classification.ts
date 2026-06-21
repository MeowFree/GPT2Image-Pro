export type GenerationErrorCategory =
  | "platform"
  | "moderation"
  | "user_request";

// 注意：不要把裸 "insufficient quota"/"insufficient_quota"/"unauthorized" 放进
// 来——生产中这些文案几乎都来自平台自有池(上游配额耗尽如 "no available image
// quota | insufficient_quota"、池账号 401)，归 user_request 会把平台事故从
// SLA 成功率分母中剔除。用户侧额度问题用更具体的模式(积分不足/api key
// quota exceeded/invalid or missing api key 等)匹配。
const USER_REQUEST_PATTERNS = [
  "积分不足",
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
  // 透明背景/输出格式不被命中模型支持：是用户参数与模型能力不匹配,切后端也救不了,算用户错。
  "transparent background is not supported",
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
  "account frozen",
];

const MODERATION_SERVICE_FAILURE_PATTERNS = [
  "aliyun moderation timed out",
  "aliyun moderation failed",
  "content moderation failed",
  "moderation skipped unexpectedly",
  "moderation timed out",
  "moderation failed",
  "socket hang up",
  "socket closed",
  "connection reset",
  "econnreset",
  "operation was aborted",
  "temporarily unavailable",
  "service unavailable",
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
  "targeted abusive text",
  "abusive text",
  "sexualized image",
  "sexually suggestive",
  "explicit sexual",
  "sexual content",
  "未能通过安全",
  "安全系统",
  "安全限制",
  "安全过滤器",
  "安全机制",
  "系统安全",
  "系统拦截",
  "系统拒绝",
  "生成系统审核",
  "生成系统的安全检查",
  "内容审查",
  "露骨",
  "性暗示",
  "明显性化",
  "非性化",
  "裸露",
  "自伤",
  "未成年人",
  "受版权保护",
  "敏感性亲密",
  "近距离打击",
  "打斗/攻击",
  "暴力伤害",
  "强烈恐怖伤害",
  "成人性",
  "不能帮助",
  "不能协助",
  "不能生成",
  "无法生成",
  "无法处理这张图",
  "无法直接生成",
];

const APOLOGY_REFUSAL_PATTERNS = [
  "i can't",
  "i cannot",
  "i won't",
  "i couldn't",
  "can't help",
  "can't create",
  "can't generate",
  "can't complete",
  "can't process",
  "cannot help",
  "cannot create",
  "cannot generate",
  "cannot complete",
  "cannot process",
  "couldn't complete",
  "could not complete",
  "not able to",
  "not allowed",
  "request was rejected",
  "request is rejected",
  "was rejected",
  "blocked",
  "flagged",
  "abusive",
  "copyright",
  "protected",
  "sexualized",
  "explicit",
  "我不能",
  "不能生成",
  "不能协助",
  "不能帮助",
  "不能按",
  "不能保留",
  "不能将",
  "不能处理",
  "我无法",
  "无法生成",
  "无法处理",
  "无法帮助",
  "无法按",
  "未能",
  "拒绝",
  "拦截",
  "安全",
  "审核",
  "受版权保护",
  "人身辱骂",
  "辱骂",
  "不允许",
];

const MODERATION_PATTERNS = [
  ...CONTENT_SAFETY_REJECTION_PATTERNS,
  "omni-moderation",
  "risklevel",
];

function normalizeErrorText(error: string | null | undefined) {
  return (error || "").toLowerCase().replace(/[’‘`]/g, "'");
}

function includesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

function isApologyRefusal(value: string) {
  const hasApology = /\bsorry\b/.test(value) || value.includes("抱歉");
  return hasApology && includesAny(value, APOLOGY_REFUSAL_PATTERNS);
}

function isModerationServiceFailure(value: string) {
  if (value.includes("content blocked by aliyun moderation")) return false;
  if (value.includes("moderation_blocked")) return false;
  if (value.includes("safety_violations")) return false;
  return includesAny(value, MODERATION_SERVICE_FAILURE_PATTERNS);
}

export function isContentSafetyRejection(error: string | null | undefined) {
  const normalized = normalizeErrorText(error);
  if (isModerationServiceFailure(normalized)) return false;
  return (
    includesAny(normalized, CONTENT_SAFETY_REJECTION_PATTERNS) ||
    isApologyRefusal(normalized)
  );
}

export function classifyGenerationError(error: string | null | undefined) {
  const normalized = normalizeErrorText(error);
  if (isModerationServiceFailure(normalized)) {
    return "platform" satisfies GenerationErrorCategory;
  }
  if (includesAny(normalized, USER_REQUEST_PATTERNS)) {
    return "user_request" satisfies GenerationErrorCategory;
  }
  if (
    isContentSafetyRejection(error) ||
    includesAny(normalized, MODERATION_PATTERNS)
  ) {
    return "moderation" satisfies GenerationErrorCategory;
  }
  return "platform" satisfies GenerationErrorCategory;
}
