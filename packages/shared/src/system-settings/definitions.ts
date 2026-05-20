export type SettingCategory =
  | "general"
  | "auth"
  | "payment"
  | "plans"
  | "moderation"
  | "models"
  | "storage"
  | "mail"
  | "credits"
  | "analytics";

export type SettingValueType = "string" | "number" | "boolean" | "select";

export type SettingKey =
  | "NEXT_PUBLIC_APP_URL"
  | "NEXT_PUBLIC_ADMIN_URL"
  | "NEXT_PUBLIC_APP_NAME"
  | "NEXT_PUBLIC_ASSET_PREFIX"
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "PAYMENT_PROVIDER"
  | "NEXT_PUBLIC_PAYMENT_PROVIDER"
  | "NEXT_PUBLIC_CREEM_PRICE_STARTER_MONTHLY"
  | "NEXT_PUBLIC_CREEM_PRICE_STARTER_YEARLY"
  | "NEXT_PUBLIC_CREEM_PRICE_PRO_MONTHLY"
  | "NEXT_PUBLIC_CREEM_PRICE_PRO_YEARLY"
  | "NEXT_PUBLIC_CREEM_PRICE_ULTRA_MONTHLY"
  | "NEXT_PUBLIC_CREEM_PRICE_ULTRA_YEARLY"
  | "NEXT_PUBLIC_CREEM_PRICE_ENTERPRISE_MONTHLY"
  | "NEXT_PUBLIC_CREEM_PRICE_ENTERPRISE_YEARLY"
  | "CREEM_API_KEY"
  | "CREEM_WEBHOOK_SECRET"
  | "EPAY_PID"
  | "EPAY_KEY"
  | "EPAY_API_URL"
  | "EPAY_NOTIFY_URL"
  | "EPAY_DEFAULT_PAYMENT_TYPE"
  | "NEXT_PUBLIC_EPAY_DEFAULT_PAYMENT_TYPE"
  | "BILLING_YEARLY_ENABLED"
  | "PLAN_STARTER_MONTHLY_CREDITS"
  | "PLAN_PRO_MONTHLY_CREDITS"
  | "PLAN_ULTRA_MONTHLY_CREDITS"
  | "PLAN_ENTERPRISE_MONTHLY_CREDITS"
  | "PLAN_FREE_MAX_FILE_MB"
  | "PLAN_FREE_MAX_UPLOAD_MB"
  | "PLAN_STARTER_MAX_FILE_MB"
  | "PLAN_STARTER_MAX_UPLOAD_MB"
  | "PLAN_PRO_MAX_FILE_MB"
  | "PLAN_PRO_MAX_UPLOAD_MB"
  | "PLAN_ULTRA_MAX_FILE_MB"
  | "PLAN_ULTRA_MAX_UPLOAD_MB"
  | "PLAN_ENTERPRISE_MAX_FILE_MB"
  | "PLAN_ENTERPRISE_MAX_UPLOAD_MB"
  | "PLAN_STARTER_MONTHLY_AMOUNT"
  | "PLAN_STARTER_YEARLY_AMOUNT"
  | "PLAN_PRO_MONTHLY_AMOUNT"
  | "PLAN_PRO_YEARLY_AMOUNT"
  | "PLAN_ULTRA_MONTHLY_AMOUNT"
  | "PLAN_ULTRA_YEARLY_AMOUNT"
  | "PLAN_ENTERPRISE_MONTHLY_AMOUNT"
  | "PLAN_ENTERPRISE_YEARLY_AMOUNT"
  | "ENTERPRISE_RESOURCE_PACK_CREDITS"
  | "ENTERPRISE_RESOURCE_PACK_PRICE"
  | "CONTENT_MODERATION_ENABLED"
  | "CONTENT_MODERATION_FAIL_CLOSED"
  | "CONTENT_MODERATION_PROVIDER"
  | "CONTENT_MODERATION_PROXY_URL"
  | "CONTENT_MODERATION_PROXY_SECRET"
  | "CONTENT_MODERATION_PROXY_GATEWAY_SECRET"
  | "CONTENT_MODERATION_PROXY_TIMEOUT_MS"
  | "CONTENT_MODERATION_PROVIDER_TIMEOUT_MS"
  | "CONTENT_MODERATION_PUBLIC_BASE_URL"
  | "ALIYUN_MODERATION_ACCESS_KEY_ID"
  | "ALIYUN_MODERATION_ACCESS_KEY_SECRET"
  | "ALIYUN_MODERATION_REGION_ID"
  | "ALIYUN_MODERATION_ENDPOINT"
  | "ALIYUN_MODERATION_TEXT_REGION_ID"
  | "ALIYUN_MODERATION_TEXT_ENDPOINT"
  | "ALIYUN_MODERATION_TEXT_SERVICE"
  | "ALIYUN_MODERATION_IMAGE_REGION_ID"
  | "ALIYUN_MODERATION_IMAGE_ENDPOINT"
  | "ALIYUN_MODERATION_IMAGE_SERVICE"
  | "ALIYUN_MODERATION_BLOCK_RISK_LEVEL"
  | "ALIYUN_MODERATION_TEXT_APP_ID"
  | "ALIYUN_MODERATION_IMAGE_APP_ID"
  | "ALIYUN_MODERATION_PUBLIC_BASE_URL"
  | "OPENAI_MODERATION_API_KEY"
  | "OPENAI_MODERATION_MODEL"
  | "PLATFORM_API_BASE_URL"
  | "PLATFORM_API_KEY"
  | "PLATFORM_IMAGE_MODEL"
  | "PLATFORM_RESPONSES_MODEL"
  | "PLATFORM_CHAT_MODEL"
  | "CHATGPT_WEB_PROXY_URL"
  | "CHATGPT_WEB_PROXY_SECRET"
  | "CHATGPT_WEB_ACCOUNT_REFRESH_STALE_MINUTES"
  | "CHATGPT_WEB_ACCOUNT_REFRESH_LIMIT"
  | "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES"
  | "IMAGE_BACKEND_UNRECOVERABLE_ERROR_KEYWORDS"
  | "SUB2API_POSTGRES_URL"
  | "SUB2API_POSTGRES_SYNC_LIMIT"
  | "OPENAI_API_KEY"
  | "OPENAI_MODEL"
  | "DEEPSEEK_API_KEY"
  | "DEEPSEEK_MODEL"
  | "MIMO_API_KEY"
  | "MIMO_MODEL"
  | "CF_AIG_BASE_URL"
  | "CF_AIG_TOKEN"
  | "AI_PROVIDER"
  | "STORAGE_ACCESS_KEY_ID"
  | "STORAGE_SECRET_ACCESS_KEY"
  | "STORAGE_ENDPOINT"
  | "STORAGE_REGION"
  | "STORAGE_BUCKET_NAME"
  | "NEXT_PUBLIC_AVATARS_BUCKET_NAME"
  | "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME"
  | "LOCAL_STORAGE_PATH"
  | "EMAIL_PROVIDER"
  | "EMAIL_FROM"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_SECURE"
  | "SMTP_USER"
  | "SMTP_PASS"
  | "RESEND_API_KEY"
  | "REGISTRATION_BONUS_CREDITS"
  | "FREE_CREDITS_EXPIRY_DAYS"
  | "CREDITS_EXPIRY_DAYS"
  | "NEXT_PUBLIC_GA_ID"
  | "NEXT_PUBLIC_SENTRY_DSN"
  | "SENTRY_AUTH_TOKEN"
  | "AXIOM_TOKEN"
  | "AXIOM_DATASET"
  | "CRON_SECRET"
  | "UPSTASH_REDIS_REST_URL"
  | "UPSTASH_REDIS_REST_TOKEN"
  | "INNGEST_EVENT_KEY"
  | "INNGEST_SIGNING_KEY"
  | "INNGEST_DEV"
  | "INNGEST_BASE_URL";

export interface SettingDefinition {
  key: SettingKey;
  label: string;
  description: string;
  category: SettingCategory;
  valueType: SettingValueType;
  secret?: boolean;
  requiresRestart?: boolean;
  requiresRebuild?: boolean;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: string | number | boolean;
}

export const SYSTEM_SETTING_DEFINITIONS = [
  {
    key: "NEXT_PUBLIC_APP_URL",
    label: "应用地址",
    description: "Web 站点公开访问地址，用于回调、邮件链接和图片 URL。",
    category: "general",
    valueType: "string",
    requiresRestart: true,
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_ADMIN_URL",
    label: "管理后台地址",
    description: "Admin 站点公开访问地址，用于认证可信来源。",
    category: "general",
    valueType: "string",
    requiresRestart: true,
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_APP_NAME",
    label: "应用名称",
    description: "公开展示的应用名称，用于邮件、页面和通知。",
    category: "general",
    valueType: "string",
    defaultValue: "GPT2IMAGE",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_ASSET_PREFIX",
    label: "静态资源前缀",
    description: "Next.js assetPrefix。用于 CDN 或静态资源版本路径。",
    category: "general",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "BETTER_AUTH_SECRET",
    label: "认证 Cookie 密钥",
    description: "Better Auth 会话签名密钥，修改后已有会话可能失效。",
    category: "auth",
    valueType: "string",
    secret: true,
    requiresRestart: true,
  },
  {
    key: "BETTER_AUTH_URL",
    label: "认证服务地址",
    description: "Better Auth 基础 URL，OAuth 回调依赖此值。",
    category: "auth",
    valueType: "string",
    requiresRestart: true,
  },
  {
    key: "GOOGLE_CLIENT_ID",
    label: "Google Client ID",
    description: "Google OAuth 客户端 ID。",
    category: "auth",
    valueType: "string",
    requiresRestart: true,
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google Client Secret",
    description: "Google OAuth 客户端密钥。",
    category: "auth",
    valueType: "string",
    secret: true,
    requiresRestart: true,
  },
  {
    key: "GITHUB_CLIENT_ID",
    label: "GitHub Client ID",
    description: "GitHub OAuth 客户端 ID。",
    category: "auth",
    valueType: "string",
    requiresRestart: true,
  },
  {
    key: "GITHUB_CLIENT_SECRET",
    label: "GitHub Client Secret",
    description: "GitHub OAuth 客户端密钥。",
    category: "auth",
    valueType: "string",
    secret: true,
    requiresRestart: true,
  },
  {
    key: "PAYMENT_PROVIDER",
    label: "支付通道",
    description: "选择 Creem 或易支付。",
    category: "payment",
    valueType: "select",
    options: [
      { label: "Creem", value: "creem" },
      { label: "易支付", value: "epay" },
    ],
    defaultValue: "creem",
  },
  {
    key: "NEXT_PUBLIC_PAYMENT_PROVIDER",
    label: "前端支付通道",
    description: "前端展示用支付通道，应与支付通道保持一致。",
    category: "payment",
    valueType: "select",
    options: [
      { label: "Creem", value: "creem" },
      { label: "易支付", value: "epay" },
    ],
    defaultValue: "creem",
    requiresRebuild: true,
  },
  {
    key: "CREEM_API_KEY",
    label: "Creem API Key",
    description: "Creem 支付接口密钥。",
    category: "payment",
    valueType: "string",
    secret: true,
  },
  {
    key: "CREEM_WEBHOOK_SECRET",
    label: "Creem Webhook Secret",
    description: "Creem Webhook 签名密钥。",
    category: "payment",
    valueType: "string",
    secret: true,
  },
  {
    key: "EPAY_PID",
    label: "易支付商户 ID",
    description: "易支付 pid。",
    category: "payment",
    valueType: "string",
  },
  {
    key: "EPAY_KEY",
    label: "易支付商户密钥",
    description: "易支付签名密钥。",
    category: "payment",
    valueType: "string",
    secret: true,
  },
  {
    key: "EPAY_API_URL",
    label: "易支付接口地址",
    description: "易支付网关地址。",
    category: "payment",
    valueType: "string",
  },
  {
    key: "EPAY_NOTIFY_URL",
    label: "易支付异步通知地址",
    description: "留空则使用应用地址自动生成。",
    category: "payment",
    valueType: "string",
  },
  {
    key: "EPAY_DEFAULT_PAYMENT_TYPE",
    label: "易支付默认方式",
    description: "如 alipay、wxpay。",
    category: "payment",
    valueType: "string",
    defaultValue: "alipay",
  },
  {
    key: "NEXT_PUBLIC_EPAY_DEFAULT_PAYMENT_TYPE",
    label: "前端易支付默认方式",
    description: "前端展示用默认支付方式，应与易支付默认方式保持一致。",
    category: "payment",
    valueType: "string",
    defaultValue: "alipay",
    requiresRebuild: true,
  },
  {
    key: "BILLING_YEARLY_ENABLED",
    label: "开放年付",
    description: "关闭后用户不能选择年付套餐。",
    category: "plans",
    valueType: "boolean",
    defaultValue: true,
  },
  {
    key: "PLAN_STARTER_MONTHLY_CREDITS",
    label: "Starter 月积分",
    description: "Starter 套餐每月发放积分。",
    category: "plans",
    valueType: "number",
    defaultValue: 5000,
  },
  {
    key: "PLAN_PRO_MONTHLY_CREDITS",
    label: "Pro 月积分",
    description: "Pro 套餐每月发放积分。",
    category: "plans",
    valueType: "number",
    defaultValue: 20000,
  },
  {
    key: "PLAN_ULTRA_MONTHLY_CREDITS",
    label: "Ultra 月积分",
    description: "Ultra 套餐每月发放积分。",
    category: "plans",
    valueType: "number",
    defaultValue: 80000,
  },
  {
    key: "PLAN_ENTERPRISE_MONTHLY_CREDITS",
    label: "Enterprise 月积分",
    description: "Enterprise 套餐每月发放积分。",
    category: "plans",
    valueType: "number",
    defaultValue: 320000,
  },
  {
    key: "PLAN_FREE_MAX_FILE_MB",
    label: "Free 单图上传 MB",
    description: "Free 套餐单张输入图片或蒙版的大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 5,
  },
  {
    key: "PLAN_FREE_MAX_UPLOAD_MB",
    label: "Free 总上传 MB",
    description: "Free 套餐单次图生图/对话上传的总大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 75,
  },
  {
    key: "PLAN_STARTER_MAX_FILE_MB",
    label: "Starter 单图上传 MB",
    description: "Starter 套餐单张输入图片或蒙版的大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 20,
  },
  {
    key: "PLAN_STARTER_MAX_UPLOAD_MB",
    label: "Starter 总上传 MB",
    description: "Starter 套餐单次图生图/对话上传的总大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 75,
  },
  {
    key: "PLAN_PRO_MAX_FILE_MB",
    label: "Pro 单图上传 MB",
    description: "Pro 套餐单张输入图片或蒙版的大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 50,
  },
  {
    key: "PLAN_PRO_MAX_UPLOAD_MB",
    label: "Pro 总上传 MB",
    description: "Pro 套餐单次图生图/对话上传的总大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 75,
  },
  {
    key: "PLAN_ULTRA_MAX_FILE_MB",
    label: "Ultra 单图上传 MB",
    description: "Ultra 套餐单张输入图片或蒙版的大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 100,
  },
  {
    key: "PLAN_ULTRA_MAX_UPLOAD_MB",
    label: "Ultra 总上传 MB",
    description: "Ultra 套餐单次图生图/对话上传的总大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 100,
  },
  {
    key: "PLAN_ENTERPRISE_MAX_FILE_MB",
    label: "Enterprise 单图上传 MB",
    description: "Enterprise 套餐单张输入图片或蒙版的大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 200,
  },
  {
    key: "PLAN_ENTERPRISE_MAX_UPLOAD_MB",
    label: "Enterprise 总上传 MB",
    description: "Enterprise 套餐单次图生图/对话上传的总大小上限。",
    category: "plans",
    valueType: "number",
    defaultValue: 200,
  },
  {
    key: "PLAN_STARTER_MONTHLY_AMOUNT",
    label: "Starter 月付价格",
    description: "Starter 月付价格，单位 CNY。",
    category: "plans",
    valueType: "number",
    defaultValue: 20,
  },
  {
    key: "PLAN_STARTER_YEARLY_AMOUNT",
    label: "Starter 年付价格",
    description: "Starter 年付价格，单位 CNY。",
    category: "plans",
    valueType: "number",
    defaultValue: 144,
  },
  {
    key: "PLAN_PRO_MONTHLY_AMOUNT",
    label: "Pro 月付价格",
    description: "Pro 月付价格，单位 CNY。",
    category: "plans",
    valueType: "number",
    defaultValue: 60,
  },
  {
    key: "PLAN_PRO_YEARLY_AMOUNT",
    label: "Pro 年付价格",
    description: "Pro 年付价格，单位 CNY。",
    category: "plans",
    valueType: "number",
    defaultValue: 432,
  },
  {
    key: "PLAN_ULTRA_MONTHLY_AMOUNT",
    label: "Ultra 月付价格",
    description: "Ultra 月付价格，单位 CNY。",
    category: "plans",
    valueType: "number",
    defaultValue: 200,
  },
  {
    key: "PLAN_ULTRA_YEARLY_AMOUNT",
    label: "Ultra 年付价格",
    description: "Ultra 年付价格，单位 CNY。",
    category: "plans",
    valueType: "number",
    defaultValue: 1440,
  },
  {
    key: "PLAN_ENTERPRISE_MONTHLY_AMOUNT",
    label: "Enterprise 月付价格",
    description: "Enterprise 月付价格，单位 CNY。",
    category: "plans",
    valueType: "number",
    defaultValue: 800,
  },
  {
    key: "PLAN_ENTERPRISE_YEARLY_AMOUNT",
    label: "Enterprise 年付价格",
    description: "Enterprise 年付价格，单位 CNY。",
    category: "plans",
    valueType: "number",
    defaultValue: 5760,
  },
  {
    key: "NEXT_PUBLIC_CREEM_PRICE_STARTER_MONTHLY",
    label: "Creem Starter 月付 Price ID",
    description: "Creem Starter 月付产品/价格 ID。",
    category: "plans",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_CREEM_PRICE_STARTER_YEARLY",
    label: "Creem Starter 年付 Price ID",
    description: "Creem Starter 年付产品/价格 ID。",
    category: "plans",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_CREEM_PRICE_PRO_MONTHLY",
    label: "Creem Pro 月付 Price ID",
    description: "Creem Pro 月付产品/价格 ID。",
    category: "plans",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_CREEM_PRICE_PRO_YEARLY",
    label: "Creem Pro 年付 Price ID",
    description: "Creem Pro 年付产品/价格 ID。",
    category: "plans",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_CREEM_PRICE_ULTRA_MONTHLY",
    label: "Creem Ultra 月付 Price ID",
    description: "Creem Ultra 月付产品/价格 ID。",
    category: "plans",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_CREEM_PRICE_ULTRA_YEARLY",
    label: "Creem Ultra 年付 Price ID",
    description: "Creem Ultra 年付产品/价格 ID。",
    category: "plans",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_CREEM_PRICE_ENTERPRISE_MONTHLY",
    label: "Creem Enterprise 月付 Price ID",
    description: "Creem Enterprise 月付产品/价格 ID。",
    category: "plans",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_CREEM_PRICE_ENTERPRISE_YEARLY",
    label: "Creem Enterprise 年付 Price ID",
    description: "Creem Enterprise 年付产品/价格 ID。",
    category: "plans",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "CONTENT_MODERATION_ENABLED",
    label: "开启内容审核",
    description: "控制文本/图片审核总开关。",
    category: "moderation",
    valueType: "boolean",
    defaultValue: true,
  },
  {
    key: "CONTENT_MODERATION_FAIL_CLOSED",
    label: "审核异常时拦截",
    description: "开启后审核服务不可用时拒绝请求；关闭后失败放行。",
    category: "moderation",
    valueType: "boolean",
    defaultValue: true,
  },
  {
    key: "CONTENT_MODERATION_PROVIDER",
    label: "审核服务商",
    description: "选择阿里云、OpenAI、自动或关闭。",
    category: "moderation",
    valueType: "select",
    options: [
      { label: "自动", value: "auto" },
      { label: "阿里云", value: "aliyun" },
      { label: "OpenAI", value: "openai" },
      { label: "关闭", value: "none" },
    ],
    defaultValue: "auto",
  },
  {
    key: "CONTENT_MODERATION_PROXY_URL",
    label: "审核代理地址",
    description: "可选，先请求代理审核服务。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "CONTENT_MODERATION_PROXY_SECRET",
    label: "审核代理密钥",
    description: "审核代理鉴权密钥。",
    category: "moderation",
    valueType: "string",
    secret: true,
  },
  {
    key: "CONTENT_MODERATION_PROXY_GATEWAY_SECRET",
    label: "审核网关密钥",
    description: "外部网关调用本站审核代理时使用的密钥。",
    category: "moderation",
    valueType: "string",
    secret: true,
  },
  {
    key: "CONTENT_MODERATION_PROXY_TIMEOUT_MS",
    label: "审核代理超时 ms",
    description: "审核代理请求超时时间。",
    category: "moderation",
    valueType: "number",
    defaultValue: 10000,
  },
  {
    key: "CONTENT_MODERATION_PROVIDER_TIMEOUT_MS",
    label: "审核服务超时 ms",
    description: "直接请求审核服务商的超时时间。",
    category: "moderation",
    valueType: "number",
    defaultValue: 10000,
  },
  {
    key: "CONTENT_MODERATION_PUBLIC_BASE_URL",
    label: "旧审核图片公开地址",
    description: "兼容旧配置。优先使用审核图片公开地址。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_ACCESS_KEY_ID",
    label: "阿里云 AccessKey ID",
    description: "阿里云内容安全 AccessKey ID。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_ACCESS_KEY_SECRET",
    label: "阿里云 AccessKey Secret",
    description: "阿里云内容安全 AccessKey Secret。",
    category: "moderation",
    valueType: "string",
    secret: true,
  },
  {
    key: "ALIYUN_MODERATION_REGION_ID",
    label: "阿里云默认 Region",
    description: "默认 cn-shanghai。",
    category: "moderation",
    valueType: "string",
    defaultValue: "cn-shanghai",
  },
  {
    key: "ALIYUN_MODERATION_ENDPOINT",
    label: "阿里云默认 Endpoint",
    description: "可选。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_TEXT_REGION_ID",
    label: "阿里云文本 Region",
    description: "文本审核专用 Region。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_TEXT_ENDPOINT",
    label: "阿里云文本 Endpoint",
    description: "文本审核专用 Endpoint。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_TEXT_SERVICE",
    label: "阿里云文本服务",
    description: "阿里云文本审核 service code。",
    category: "moderation",
    valueType: "string",
    defaultValue: "ugc_moderation_byllm_cb",
  },
  {
    key: "ALIYUN_MODERATION_IMAGE_REGION_ID",
    label: "阿里云图片 Region",
    description: "图片审核专用 Region。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_IMAGE_ENDPOINT",
    label: "阿里云图片 Endpoint",
    description: "图片审核专用 Endpoint。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_IMAGE_SERVICE",
    label: "阿里云图片服务",
    description: "图片审核服务 code。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_BLOCK_RISK_LEVEL",
    label: "阿里云拦截风险等级",
    description:
      "达到该风险等级即拦截。low 表示更严格，只允许 none；medium 表示兼容旧逻辑，允许 none/low。",
    category: "moderation",
    valueType: "select",
    options: [
      { label: "严格：拦截 low 及以上", value: "low" },
      { label: "默认：拦截 medium 及以上", value: "medium" },
      { label: "宽松：仅拦截 high", value: "high" },
    ],
    defaultValue: "medium",
  },
  {
    key: "ALIYUN_MODERATION_TEXT_APP_ID",
    label: "阿里云文本 App ID",
    description: "多模态 Agent 文本 App ID。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_IMAGE_APP_ID",
    label: "阿里云图片 App ID",
    description: "多模态 Agent 图片 App ID。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "ALIYUN_MODERATION_PUBLIC_BASE_URL",
    label: "审核图片公开地址",
    description: "图片审核临时文件公开基础地址。",
    category: "moderation",
    valueType: "string",
  },
  {
    key: "OPENAI_MODERATION_API_KEY",
    label: "OpenAI 审核 API Key",
    description: "OpenAI moderation 使用的密钥。",
    category: "moderation",
    valueType: "string",
    secret: true,
  },
  {
    key: "OPENAI_MODERATION_MODEL",
    label: "OpenAI 审核模型",
    description: "默认 omni-moderation-latest。",
    category: "moderation",
    valueType: "string",
    defaultValue: "omni-moderation-latest",
  },
  {
    key: "PLATFORM_API_BASE_URL",
    label: "平台模型 API 地址",
    description: "OpenAI 兼容 /v1 基础地址。",
    category: "models",
    valueType: "string",
  },
  {
    key: "PLATFORM_API_KEY",
    label: "平台模型 API Key",
    description: "站内默认模型调用密钥。",
    category: "models",
    valueType: "string",
    secret: true,
  },
  {
    key: "PLATFORM_IMAGE_MODEL",
    label: "默认生图模型",
    description: "图片生成默认模型。",
    category: "models",
    valueType: "string",
  },
  {
    key: "PLATFORM_RESPONSES_MODEL",
    label: "默认对话模型",
    description: "对话生图使用的 Responses 模型。",
    category: "models",
    valueType: "string",
  },
  {
    key: "PLATFORM_CHAT_MODEL",
    label: "备用对话模型",
    description: "兼容旧配置。",
    category: "models",
    valueType: "string",
  },
  {
    key: "CHATGPT_WEB_PROXY_URL",
    label: "ChatGPT Web TLS 代理地址",
    description:
      "可选。配置后 Web 账号请求会经 Go tls-client sidecar 转发，例如 http://chatgpt-web-proxy:3021。",
    category: "models",
    valueType: "string",
  },
  {
    key: "CHATGPT_WEB_PROXY_SECRET",
    label: "ChatGPT Web TLS 代理密钥",
    description: "可选。请求 sidecar 时写入 X-Proxy-Secret。",
    category: "models",
    valueType: "string",
    secret: true,
  },
  {
    key: "CHATGPT_WEB_ACCOUNT_REFRESH_STALE_MINUTES",
    label: "Web 账号刷新间隔分钟",
    description: "后台任务刷新超过该时间未同步额度的 Web 账号。",
    category: "models",
    valueType: "number",
    defaultValue: 30,
  },
  {
    key: "CHATGPT_WEB_ACCOUNT_REFRESH_LIMIT",
    label: "Web 账号单次刷新数量",
    description: "后台任务每次最多刷新多少个 Web 账号。",
    category: "models",
    valueType: "number",
    defaultValue: 20,
  },
  {
    key: "IMAGE_BACKEND_DEFAULT_COOLDOWN_MINUTES",
    label: "后端默认恢复分钟",
    description:
      "生图后端错误没有命中更具体规则时的默认冷却时间。未配置时为 15 分钟。",
    category: "models",
    valueType: "number",
    defaultValue: 15,
  },
  {
    key: "IMAGE_BACKEND_RATE_LIMIT_COOLDOWN_MINUTES",
    label: "后端 429 兜底恢复分钟",
    description:
      "账号/API 返回 429、rate limit、too many requests 时的兜底冷却时间；如上游返回 Retry-After 或 reset 时间，会优先按上游时间恢复。",
    category: "models",
    valueType: "number",
    defaultValue: 15,
  },
  {
    key: "IMAGE_BACKEND_OVERLOAD_COOLDOWN_MINUTES",
    label: "后端 529/过载兜底恢复分钟",
    description:
      "账号/API 返回 529、overloaded、temporarily unavailable、server overloaded 时的兜底冷却时间；如上游返回恢复时间，会优先按上游时间恢复。",
    category: "models",
    valueType: "number",
    defaultValue: 15,
  },
  {
    key: "IMAGE_BACKEND_USAGE_LIMIT_COOLDOWN_MINUTES",
    label: "后端额度限制兜底恢复分钟",
    description:
      "账号/API 返回 usage limit、quota exceeded、insufficient quota、billing hard limit 时的兜底冷却时间；如上游返回 Retry-After、resetAt、reset_at、reset_after、restoreAt 等恢复时间，会优先按上游时间恢复。",
    category: "models",
    valueType: "number",
    defaultValue: 15,
  },
  {
    key: "IMAGE_BACKEND_UNSUPPORTED_MODEL_COOLDOWN_MINUTES",
    label: "后端模型不支持兜底恢复分钟",
    description:
      "账号额度未用完但返回不支持该模型、model not supported、unsupported model 时的兜底冷却时间；如上游返回恢复时间，会优先按上游时间恢复。",
    category: "models",
    valueType: "number",
    defaultValue: 15,
  },
  {
    key: "IMAGE_BACKEND_TEMPORARY_ERROR_COOLDOWN_MINUTES",
    label: "后端临时错误兜底恢复分钟",
    description:
      "超时、连接失败、502/503/504 等临时错误的兜底冷却时间；如上游返回恢复时间，会优先按上游时间恢复。",
    category: "models",
    valueType: "number",
    defaultValue: 15,
  },
  {
    key: "IMAGE_BACKEND_UNRECOVERABLE_ERROR_KEYWORDS",
    label: "后端不可恢复错误关键词",
    description:
      "命中这些关键词时，账号/API 会直接标记为错误并跳过后续调度。支持用逗号、换行或分号分隔。",
    category: "models",
    valueType: "string",
    defaultValue:
      "refresh token, invalid refresh token, invalid_grant, authentication, account deactivated, deactivated account",
  },
  {
    key: "SUB2API_POSTGRES_URL",
    label: "Sub2API Postgres 地址",
    description:
      "连接 Sub2API 数据库，用于读取当前 AT/RT，并在 Web AT 刷新后回写最新 refresh_token。需要 accounts.credentials 更新权限。",
    category: "models",
    valueType: "string",
    secret: true,
  },
  {
    key: "SUB2API_POSTGRES_SYNC_LIMIT",
    label: "Sub2API 单次同步账号数",
    description: "从 Sub2API 数据库单次最多读取多少个 OpenAI OAuth 账号。",
    category: "models",
    valueType: "number",
    defaultValue: 100,
  },
  {
    key: "AI_PROVIDER",
    label: "旧 AI 提供商",
    description: "兼容旧对话/文档模块，可选 openai、deepseek、mimo。",
    category: "models",
    valueType: "select",
    options: [
      { label: "OpenAI", value: "openai" },
      { label: "DeepSeek", value: "deepseek" },
      { label: "MiMo", value: "mimo" },
    ],
    defaultValue: "openai",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    description: "旧通用 OpenAI 客户端密钥；审核优先使用专用审核密钥。",
    category: "models",
    valueType: "string",
    secret: true,
  },
  {
    key: "OPENAI_MODEL",
    label: "OpenAI 文本模型",
    description: "旧通用 OpenAI 客户端默认模型。",
    category: "models",
    valueType: "string",
    defaultValue: "gpt-4o-mini",
  },
  {
    key: "DEEPSEEK_API_KEY",
    label: "DeepSeek API Key",
    description: "旧 DeepSeek 客户端密钥。",
    category: "models",
    valueType: "string",
    secret: true,
  },
  {
    key: "DEEPSEEK_MODEL",
    label: "DeepSeek 文本模型",
    description: "旧 DeepSeek 客户端默认模型。",
    category: "models",
    valueType: "string",
    defaultValue: "deepseek-chat",
  },
  {
    key: "MIMO_API_KEY",
    label: "MiMo API Key",
    description: "旧小米 MiMo 客户端密钥。",
    category: "models",
    valueType: "string",
    secret: true,
  },
  {
    key: "MIMO_MODEL",
    label: "MiMo 文本模型",
    description: "旧小米 MiMo 客户端默认模型。",
    category: "models",
    valueType: "string",
    defaultValue: "mimo-v2-flash",
  },
  {
    key: "CF_AIG_BASE_URL",
    label: "Cloudflare AI Gateway",
    description: "旧 AI Gateway 基础地址。",
    category: "models",
    valueType: "string",
  },
  {
    key: "CF_AIG_TOKEN",
    label: "Cloudflare AI Gateway Token",
    description: "旧 AI Gateway 鉴权 Token。",
    category: "models",
    valueType: "string",
    secret: true,
  },
  {
    key: "STORAGE_ACCESS_KEY_ID",
    label: "存储 AccessKey ID",
    description: "S3/R2/MinIO AccessKey ID。",
    category: "storage",
    valueType: "string",
  },
  {
    key: "STORAGE_SECRET_ACCESS_KEY",
    label: "存储 Secret AccessKey",
    description: "S3/R2/MinIO Secret。",
    category: "storage",
    valueType: "string",
    secret: true,
  },
  {
    key: "STORAGE_ENDPOINT",
    label: "存储 Endpoint",
    description: "S3 兼容存储 endpoint。留空使用本地存储。",
    category: "storage",
    valueType: "string",
  },
  {
    key: "STORAGE_REGION",
    label: "存储 Region",
    description: "默认 auto。",
    category: "storage",
    valueType: "string",
    defaultValue: "auto",
  },
  {
    key: "STORAGE_BUCKET_NAME",
    label: "上传 Bucket",
    description: "通用上传 bucket。",
    category: "storage",
    valueType: "string",
  },
  {
    key: "NEXT_PUBLIC_AVATARS_BUCKET_NAME",
    label: "头像 Bucket",
    description: "头像文件 bucket。",
    category: "storage",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_GENERATIONS_BUCKET_NAME",
    label: "生成图片 Bucket",
    description: "生成图片文件 bucket。",
    category: "storage",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "LOCAL_STORAGE_PATH",
    label: "本地存储路径",
    description: "未启用 S3 时的本地文件目录。",
    category: "storage",
    valueType: "string",
  },
  {
    key: "EMAIL_PROVIDER",
    label: "邮件通道",
    description: "smtp 或 resend。",
    category: "mail",
    valueType: "select",
    options: [
      { label: "SMTP", value: "smtp" },
      { label: "Resend", value: "resend" },
    ],
  },
  {
    key: "EMAIL_FROM",
    label: "发件人",
    description: "如 GPT2IMAGE <noreply@example.com>。",
    category: "mail",
    valueType: "string",
  },
  {
    key: "SMTP_HOST",
    label: "SMTP Host",
    description: "SMTP 服务器地址。",
    category: "mail",
    valueType: "string",
  },
  {
    key: "SMTP_PORT",
    label: "SMTP Port",
    description: "默认 465。",
    category: "mail",
    valueType: "number",
    defaultValue: 465,
  },
  {
    key: "SMTP_SECURE",
    label: "SMTP SSL",
    description: "是否使用 SSL。",
    category: "mail",
    valueType: "boolean",
    defaultValue: true,
  },
  {
    key: "SMTP_USER",
    label: "SMTP 用户名",
    description: "SMTP 登录用户名。",
    category: "mail",
    valueType: "string",
  },
  {
    key: "SMTP_PASS",
    label: "SMTP 密码",
    description: "SMTP 登录密码。",
    category: "mail",
    valueType: "string",
    secret: true,
  },
  {
    key: "RESEND_API_KEY",
    label: "Resend API Key",
    description: "Resend 邮件 API Key。",
    category: "mail",
    valueType: "string",
    secret: true,
  },
  {
    key: "REGISTRATION_BONUS_CREDITS",
    label: "注册奖励积分",
    description: "新用户首次进入账户时发放的积分。",
    category: "credits",
    valueType: "number",
    defaultValue: 100,
  },
  {
    key: "FREE_CREDITS_EXPIRY_DAYS",
    label: "免费积分有效期天数",
    description: "注册奖励和管理员赠送等免费积分的默认有效期。",
    category: "credits",
    valueType: "number",
    defaultValue: 7,
  },
  {
    key: "CREDITS_EXPIRY_DAYS",
    label: "积分包有效期天数",
    description: "按量购买积分默认有效期。免费积分和订阅积分使用各自规则。",
    category: "credits",
    valueType: "number",
    defaultValue: 365,
  },
  {
    key: "ENTERPRISE_RESOURCE_PACK_CREDITS",
    label: "企业资源包积分",
    description: "每份企业资源包发放的积分数量。",
    category: "credits",
    valueType: "number",
    defaultValue: 5000,
  },
  {
    key: "ENTERPRISE_RESOURCE_PACK_PRICE",
    label: "企业资源包价格",
    description: "每份企业资源包价格，单位 CNY。",
    category: "credits",
    valueType: "number",
    defaultValue: 15,
  },
  {
    key: "NEXT_PUBLIC_GA_ID",
    label: "Google Analytics ID",
    description: "GA Measurement ID。",
    category: "analytics",
    valueType: "string",
    requiresRebuild: true,
  },
  {
    key: "NEXT_PUBLIC_SENTRY_DSN",
    label: "Sentry DSN",
    description: "Sentry 监控 DSN。",
    category: "analytics",
    valueType: "string",
    secret: true,
    requiresRebuild: true,
  },
  {
    key: "SENTRY_AUTH_TOKEN",
    label: "Sentry Auth Token",
    description: "Sentry sourcemap 上传 Token。",
    category: "analytics",
    valueType: "string",
    secret: true,
    requiresRebuild: true,
  },
  {
    key: "AXIOM_TOKEN",
    label: "Axiom Token",
    description: "Axiom 日志采集 Token。",
    category: "analytics",
    valueType: "string",
    secret: true,
  },
  {
    key: "AXIOM_DATASET",
    label: "Axiom Dataset",
    description: "Axiom 日志数据集名称。",
    category: "analytics",
    valueType: "string",
    defaultValue: "gpt2image",
  },
  {
    key: "CRON_SECRET",
    label: "Cron 密钥",
    description: "定时任务鉴权密钥。",
    category: "general",
    valueType: "string",
    secret: true,
  },
  {
    key: "UPSTASH_REDIS_REST_URL",
    label: "Upstash Redis URL",
    description: "限流 Redis REST URL。",
    category: "general",
    valueType: "string",
  },
  {
    key: "UPSTASH_REDIS_REST_TOKEN",
    label: "Upstash Redis Token",
    description: "限流 Redis REST Token。",
    category: "general",
    valueType: "string",
    secret: true,
  },
  {
    key: "INNGEST_EVENT_KEY",
    label: "Inngest Event Key",
    description: "Inngest 事件密钥。",
    category: "general",
    valueType: "string",
    secret: true,
  },
  {
    key: "INNGEST_SIGNING_KEY",
    label: "Inngest Signing Key",
    description: "Inngest Webhook 签名密钥。",
    category: "general",
    valueType: "string",
    secret: true,
  },
  {
    key: "INNGEST_DEV",
    label: "Inngest 开发模式",
    description: "本地开发模式开关，生产通常关闭。",
    category: "general",
    valueType: "boolean",
    defaultValue: false,
  },
  {
    key: "INNGEST_BASE_URL",
    label: "Inngest Dev Server",
    description: "本地 Inngest Dev Server 地址。",
    category: "general",
    valueType: "string",
  },
] as const satisfies readonly SettingDefinition[];

export const SETTING_DEFINITION_BY_KEY = new Map<SettingKey, SettingDefinition>(
  SYSTEM_SETTING_DEFINITIONS.map((definition) => [definition.key, definition])
);

export const SETTING_CATEGORIES: Array<{
  id: SettingCategory;
  label: string;
  description: string;
}> = [
  {
    id: "general",
    label: "基础",
    description: "站点地址、任务密钥和限流等全局配置。",
  },
  {
    id: "auth",
    label: "登录",
    description: "Better Auth 与第三方 OAuth 配置。",
  },
  {
    id: "payment",
    label: "支付",
    description: "支付通道、Creem 和易支付密钥。",
  },
  {
    id: "plans",
    label: "套餐",
    description: "年付开关、套餐价格和积分额度。",
  },
  {
    id: "moderation",
    label: "审核",
    description: "文本/图片审核服务和密钥。",
  },
  {
    id: "models",
    label: "模型",
    description: "默认模型 API、密钥和模型名。",
  },
  {
    id: "storage",
    label: "存储",
    description: "S3/R2/MinIO 与本地存储配置。",
  },
  {
    id: "mail",
    label: "邮件",
    description: "SMTP 或 Resend 邮件配置。",
  },
  {
    id: "credits",
    label: "积分",
    description: "注册奖励和积分有效期规则。",
  },
  {
    id: "analytics",
    label: "监控",
    description: "统计与错误监控配置。",
  },
];

export function isSettingKey(value: string): value is SettingKey {
  return SETTING_DEFINITION_BY_KEY.has(value as SettingKey);
}
