import {
  MODERATION_BLOCK_RISK_LEVELS,
  PLAN_PRIVILEGES,
  PLAN_RANK,
  SUBSCRIPTION_PLANS,
  isModerationBlockRiskLevel,
  isPlanAtLeast,
  isSubscriptionPlan,
  type ModerationBlockRiskLevel,
  type QueuePriority,
  type SubscriptionPlan,
} from "../../config/subscription-plan";
import {
  getRuntimeSettingJson,
  getRuntimeSettingNumber,
} from "../../system-settings";

const BYTES_PER_MB = 1024 * 1024;
const MAX_LIMIT_VALUE = 1_000_000;
const MAX_BATCH_COUNT = 100;
const MAX_IMAGE_COUNT = 100;
const MAX_CHAT_CONTEXT_CHARS = 200_000;

const QUEUE_PRIORITY_RANK: Record<QueuePriority, number> = {
  normal: 1,
  priority: 2,
  highest: 3,
};
const QUEUE_PRIORITIES = ["normal", "priority", "highest"] as const;
const MODERATION_RANK: Record<ModerationBlockRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const PLAN_CAPABILITY_MATRIX_SETTING_KEY = "PLAN_CAPABILITY_MATRIX";

export const PLAN_CAPABILITY_KEYS = [
  "imageGeneration.text",
  "imageGeneration.edit",
  "imageGeneration.chat",
  "imageGeneration.batch",
  "promptOptimization.control",
  "models.gpt55",
  "customApi.configure",
  "backendGroups.select",
  "externalApi.keys.manage",
  "externalApi.models.list",
  "externalApi.chat.completions",
  "externalApi.images.generate",
  "externalApi.images.edit",
  "externalApi.responses",
  "externalApi.streaming",
  "moderation.blocking",
  "moderation.riskLevelControl",
  "moderation.onlyFailureSettlement",
] as const;

export type PlanCapabilityKey = (typeof PLAN_CAPABILITY_KEYS)[number];

export type PlanLimitConfig = {
  maxFileMb: number;
  maxUploadMb: number;
  queuePriority: QueuePriority;
  imageGenerationConcurrency: number;
  monthlyCredits: number;
  maxBatchCount: number;
  maxEditImages: number;
  maxChatImages: number;
  maxChatContextChars: number;
};

export type PlanModerationConfig = {
  defaultBlockRiskLevel: ModerationBlockRiskLevel;
  maxBlockRiskLevel: ModerationBlockRiskLevel;
};

export type PlanCapabilityMatrix = {
  version: 1;
  features: Record<PlanCapabilityKey, SubscriptionPlan>;
  limits: Record<SubscriptionPlan, PlanLimitConfig>;
  moderation: Record<SubscriptionPlan, PlanModerationConfig>;
};

export type PlanCapabilitySnapshot = {
  plan: SubscriptionPlan;
  features: Record<PlanCapabilityKey, boolean>;
  limits: PlanLimitConfig & {
    maxFileSizeBytes: number;
    maxUploadBytes: number;
  };
  moderation: PlanModerationConfig & {
    allowedBlockRiskLevels: ModerationBlockRiskLevel[];
  };
};

export const DEFAULT_PLAN_CAPABILITY_MATRIX: PlanCapabilityMatrix = {
  version: 1,
  features: {
    "imageGeneration.text": "free",
    "imageGeneration.edit": "free",
    "imageGeneration.chat": "pro",
    "imageGeneration.batch": "free",
    "promptOptimization.control": "pro",
    "models.gpt55": "ultra",
    "customApi.configure": "starter",
    "backendGroups.select": "free",
    "externalApi.keys.manage": "starter",
    "externalApi.models.list": "starter",
    "externalApi.chat.completions": "starter",
    "externalApi.images.generate": "starter",
    "externalApi.images.edit": "starter",
    "externalApi.responses": "pro",
    "externalApi.streaming": "starter",
    "moderation.blocking": "free",
    "moderation.riskLevelControl": "ultra",
    "moderation.onlyFailureSettlement": "ultra",
  },
  limits: {
    free: {
      maxFileMb: 5,
      maxUploadMb: 75,
      queuePriority: "normal",
      imageGenerationConcurrency: 2,
      monthlyCredits: 100,
      maxBatchCount: 10,
      maxEditImages: 16,
      maxChatImages: 16,
      maxChatContextChars: 30_000,
    },
    starter: {
      maxFileMb: 20,
      maxUploadMb: 75,
      queuePriority: "normal",
      imageGenerationConcurrency: 5,
      monthlyCredits: 5_000,
      maxBatchCount: 10,
      maxEditImages: 16,
      maxChatImages: 16,
      maxChatContextChars: 30_000,
    },
    pro: {
      maxFileMb: 50,
      maxUploadMb: 75,
      queuePriority: "priority",
      imageGenerationConcurrency: 15,
      monthlyCredits: 20_000,
      maxBatchCount: 10,
      maxEditImages: 16,
      maxChatImages: 16,
      maxChatContextChars: 30_000,
    },
    ultra: {
      maxFileMb: 100,
      maxUploadMb: 100,
      queuePriority: "highest",
      imageGenerationConcurrency: 50,
      monthlyCredits: 80_000,
      maxBatchCount: 10,
      maxEditImages: 16,
      maxChatImages: 16,
      maxChatContextChars: 30_000,
    },
    enterprise: {
      maxFileMb: 200,
      maxUploadMb: 200,
      queuePriority: "highest",
      imageGenerationConcurrency: 100,
      monthlyCredits: 320_000,
      maxBatchCount: 10,
      maxEditImages: 16,
      maxChatImages: 16,
      maxChatContextChars: 30_000,
    },
  },
  moderation: {
    free: {
      defaultBlockRiskLevel: "low",
      maxBlockRiskLevel: "low",
    },
    starter: {
      defaultBlockRiskLevel: "low",
      maxBlockRiskLevel: "low",
    },
    pro: {
      defaultBlockRiskLevel: "low",
      maxBlockRiskLevel: "low",
    },
    ultra: {
      defaultBlockRiskLevel: "medium",
      maxBlockRiskLevel: "medium",
    },
    enterprise: {
      defaultBlockRiskLevel: "high",
      maxBlockRiskLevel: "high",
    },
  },
};

export const DEFAULT_PLAN_CAPABILITY_MATRIX_JSON = JSON.stringify(
  DEFAULT_PLAN_CAPABILITY_MATRIX,
  null,
  2
);

export function megabytesToBytes(value: number) {
  return Math.floor(value * BYTES_PER_MB);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePositiveNumber(
  value: unknown,
  fallback: number,
  options?: { integer?: boolean; max?: number }
) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  const bounded = Math.min(options?.max ?? MAX_LIMIT_VALUE, numeric);
  return options?.integer ? Math.floor(bounded) : bounded;
}

function parseQueuePriority(value: unknown, fallback: QueuePriority) {
  return QUEUE_PRIORITIES.includes(value as QueuePriority)
    ? (value as QueuePriority)
    : fallback;
}

function maxQueuePriority(
  current: QueuePriority,
  floor: QueuePriority
): QueuePriority {
  return QUEUE_PRIORITY_RANK[current] >= QUEUE_PRIORITY_RANK[floor]
    ? current
    : floor;
}

function maxModerationLevel(
  current: ModerationBlockRiskLevel,
  floor: ModerationBlockRiskLevel
): ModerationBlockRiskLevel {
  return MODERATION_RANK[current] >= MODERATION_RANK[floor] ? current : floor;
}

function minModerationLevel(
  current: ModerationBlockRiskLevel,
  ceiling: ModerationBlockRiskLevel
): ModerationBlockRiskLevel {
  return MODERATION_RANK[current] <= MODERATION_RANK[ceiling]
    ? current
    : ceiling;
}

function normalizeFeatureMinimums(value: unknown) {
  const features = { ...DEFAULT_PLAN_CAPABILITY_MATRIX.features };
  if (!isRecord(value)) return features;

  for (const key of PLAN_CAPABILITY_KEYS) {
    const minPlan = value[key];
    if (isSubscriptionPlan(minPlan)) {
      features[key] = minPlan;
    }
  }

  return features;
}

function normalizePlanLimits(value: unknown) {
  const limits = structuredClone(DEFAULT_PLAN_CAPABILITY_MATRIX.limits);
  if (isRecord(value)) {
    for (const plan of SUBSCRIPTION_PLANS) {
      const raw = value[plan];
      if (!isRecord(raw)) continue;
      const fallback = limits[plan];
      limits[plan] = {
        maxFileMb: parsePositiveNumber(raw.maxFileMb, fallback.maxFileMb),
        maxUploadMb: parsePositiveNumber(raw.maxUploadMb, fallback.maxUploadMb),
        queuePriority: parseQueuePriority(
          raw.queuePriority,
          fallback.queuePriority
        ),
        imageGenerationConcurrency: parsePositiveNumber(
          raw.imageGenerationConcurrency,
          fallback.imageGenerationConcurrency,
          { integer: true, max: 1_000 }
        ),
        monthlyCredits: parsePositiveNumber(
          raw.monthlyCredits,
          fallback.monthlyCredits,
          { integer: true }
        ),
        maxBatchCount: parsePositiveNumber(
          raw.maxBatchCount,
          fallback.maxBatchCount,
          { integer: true, max: MAX_BATCH_COUNT }
        ),
        maxEditImages: parsePositiveNumber(
          raw.maxEditImages,
          fallback.maxEditImages,
          { integer: true, max: MAX_IMAGE_COUNT }
        ),
        maxChatImages: parsePositiveNumber(
          raw.maxChatImages,
          fallback.maxChatImages,
          { integer: true, max: MAX_IMAGE_COUNT }
        ),
        maxChatContextChars: parsePositiveNumber(
          raw.maxChatContextChars,
          fallback.maxChatContextChars,
          { integer: true, max: MAX_CHAT_CONTEXT_CHARS }
        ),
      };
    }
  }

  let previous: PlanLimitConfig | undefined;
  for (const plan of SUBSCRIPTION_PLANS) {
    if (!previous) {
      previous = limits[plan];
      continue;
    }
    const current = limits[plan];
    limits[plan] = {
      maxFileMb: Math.max(current.maxFileMb, previous.maxFileMb),
      maxUploadMb: Math.max(current.maxUploadMb, previous.maxUploadMb),
      queuePriority: maxQueuePriority(
        current.queuePriority,
        previous.queuePriority
      ),
      imageGenerationConcurrency: Math.max(
        current.imageGenerationConcurrency,
        previous.imageGenerationConcurrency
      ),
      monthlyCredits: Math.max(current.monthlyCredits, previous.monthlyCredits),
      maxBatchCount: Math.max(current.maxBatchCount, previous.maxBatchCount),
      maxEditImages: Math.max(current.maxEditImages, previous.maxEditImages),
      maxChatImages: Math.max(current.maxChatImages, previous.maxChatImages),
      maxChatContextChars: Math.max(
        current.maxChatContextChars,
        previous.maxChatContextChars
      ),
    };
    previous = limits[plan];
  }

  return limits;
}

function normalizeModeration(value: unknown) {
  const moderation = structuredClone(DEFAULT_PLAN_CAPABILITY_MATRIX.moderation);
  if (isRecord(value)) {
    for (const plan of SUBSCRIPTION_PLANS) {
      const raw = value[plan];
      if (!isRecord(raw)) continue;
      const fallback = moderation[plan];
      const maxBlockRiskLevel = isModerationBlockRiskLevel(
        raw.maxBlockRiskLevel
      )
        ? raw.maxBlockRiskLevel
        : fallback.maxBlockRiskLevel;
      const defaultBlockRiskLevel = isModerationBlockRiskLevel(
        raw.defaultBlockRiskLevel
      )
        ? raw.defaultBlockRiskLevel
        : fallback.defaultBlockRiskLevel;
      moderation[plan] = {
        maxBlockRiskLevel,
        defaultBlockRiskLevel: minModerationLevel(
          defaultBlockRiskLevel,
          maxBlockRiskLevel
        ),
      };
    }
  }

  let previousMax: ModerationBlockRiskLevel | undefined;
  for (const plan of SUBSCRIPTION_PLANS) {
    if (previousMax) {
      moderation[plan].maxBlockRiskLevel = maxModerationLevel(
        moderation[plan].maxBlockRiskLevel,
        previousMax
      );
      moderation[plan].defaultBlockRiskLevel = minModerationLevel(
        moderation[plan].defaultBlockRiskLevel,
        moderation[plan].maxBlockRiskLevel
      );
    }
    previousMax = moderation[plan].maxBlockRiskLevel;
  }

  return moderation;
}

async function applyLegacyPlanSettings(matrix: PlanCapabilityMatrix) {
  const legacy = structuredClone(matrix);

  for (const plan of SUBSCRIPTION_PLANS) {
    const upperPlan = plan.toUpperCase() as Uppercase<SubscriptionPlan>;
    const defaults = legacy.limits[plan];
    const [maxFileMb, maxUploadMb] = await Promise.all([
      getRuntimeSettingNumber(
        `PLAN_${upperPlan}_MAX_FILE_MB` as Parameters<
          typeof getRuntimeSettingNumber
        >[0],
        defaults.maxFileMb,
        { positive: true }
      ),
      getRuntimeSettingNumber(
        `PLAN_${upperPlan}_MAX_UPLOAD_MB` as Parameters<
          typeof getRuntimeSettingNumber
        >[0],
        defaults.maxUploadMb,
        { positive: true }
      ),
    ]);
    legacy.limits[plan].maxFileMb = maxFileMb;
    legacy.limits[plan].maxUploadMb = maxUploadMb;
  }

  for (const plan of ["starter", "pro", "ultra", "enterprise"] as const) {
    const upperPlan = plan.toUpperCase() as Uppercase<typeof plan>;
    legacy.limits[plan].monthlyCredits = await getRuntimeSettingNumber(
      `PLAN_${upperPlan}_MONTHLY_CREDITS` as Parameters<
        typeof getRuntimeSettingNumber
      >[0],
      legacy.limits[plan].monthlyCredits,
      { positive: true }
    );
  }

  legacy.limits = normalizePlanLimits(legacy.limits);
  return legacy;
}

function normalizeMatrix(value: unknown): PlanCapabilityMatrix {
  const raw = isRecord(value) ? value : {};
  return {
    version: 1,
    features: normalizeFeatureMinimums(raw.features),
    limits: normalizePlanLimits(raw.limits),
    moderation: normalizeModeration(raw.moderation),
  };
}

export async function getPlanCapabilityMatrix(): Promise<PlanCapabilityMatrix> {
  const configured = await getRuntimeSettingJson(
    PLAN_CAPABILITY_MATRIX_SETTING_KEY
  );
  if (configured !== undefined) {
    return normalizeMatrix(configured);
  }

  return applyLegacyPlanSettings(DEFAULT_PLAN_CAPABILITY_MATRIX);
}

export async function canUsePlanCapability(
  plan: SubscriptionPlan,
  key: PlanCapabilityKey
) {
  const matrix = await getPlanCapabilityMatrix();
  return isPlanAtLeast(plan, matrix.features[key]);
}

export async function getPlanLimits(plan: SubscriptionPlan) {
  const matrix = await getPlanCapabilityMatrix();
  return matrix.limits[plan];
}

export async function getPlanMonthlyCredits(plan: SubscriptionPlan) {
  const limits = await getPlanLimits(plan);
  return limits.monthlyCredits;
}

export async function getPlanQueueSettings(plan: SubscriptionPlan) {
  const limits = await getPlanLimits(plan);
  return {
    priority: limits.queuePriority,
    userConcurrency: limits.imageGenerationConcurrency,
  };
}

export async function getPlanModerationConfig(plan: SubscriptionPlan) {
  const matrix = await getPlanCapabilityMatrix();
  return matrix.moderation[plan];
}

export async function getDefaultPlanModerationBlockRiskLevel(
  plan: SubscriptionPlan
) {
  const config = await getPlanModerationConfig(plan);
  return config.defaultBlockRiskLevel;
}

export async function getMaxPlanModerationBlockRiskLevel(
  plan: SubscriptionPlan
) {
  const config = await getPlanModerationConfig(plan);
  return config.maxBlockRiskLevel;
}

export async function getAllowedPlanModerationBlockRiskLevels(
  plan: SubscriptionPlan
) {
  const maxLevel = await getMaxPlanModerationBlockRiskLevel(plan);
  const maxRank = MODERATION_RANK[maxLevel];
  return MODERATION_BLOCK_RISK_LEVELS.filter(
    (level) => MODERATION_RANK[level] <= maxRank
  );
}

export async function normalizePlanModerationBlockRiskLevel(
  plan: SubscriptionPlan,
  value?: string | null
) {
  const [fallback, maxLevel] = await Promise.all([
    getDefaultPlanModerationBlockRiskLevel(plan),
    getMaxPlanModerationBlockRiskLevel(plan),
  ]);
  const requested = isModerationBlockRiskLevel(value) ? value : fallback;
  return MODERATION_RANK[requested] > MODERATION_RANK[maxLevel]
    ? maxLevel
    : requested;
}

export async function getPlanCapabilitySnapshot(
  plan: SubscriptionPlan
): Promise<PlanCapabilitySnapshot> {
  const matrix = await getPlanCapabilityMatrix();
  const limits = matrix.limits[plan];
  const moderation = matrix.moderation[plan];
  const features = Object.fromEntries(
    PLAN_CAPABILITY_KEYS.map((key) => [
      key,
      PLAN_RANK[plan] >= PLAN_RANK[matrix.features[key]],
    ])
  ) as Record<PlanCapabilityKey, boolean>;

  return {
    plan,
    features,
    limits: {
      ...limits,
      maxFileSizeBytes: megabytesToBytes(limits.maxFileMb),
      maxUploadBytes: megabytesToBytes(limits.maxUploadMb),
    },
    moderation: {
      ...moderation,
      allowedBlockRiskLevels: MODERATION_BLOCK_RISK_LEVELS.filter(
        (level) => MODERATION_RANK[level] <= MODERATION_RANK[moderation.maxBlockRiskLevel]
      ),
    },
  };
}

export async function getPlanPrivilegesFromCapabilities(
  plan: SubscriptionPlan
) {
  const limits = await getPlanLimits(plan);
  return {
    ...PLAN_PRIVILEGES[plan],
    maxFileSizeBytes: megabytesToBytes(limits.maxFileMb),
    maxUploadBytes: megabytesToBytes(limits.maxUploadMb),
    queuePriority: limits.queuePriority,
    imageGenerationConcurrency: limits.imageGenerationConcurrency,
    monthlyCredits: limits.monthlyCredits,
  };
}
