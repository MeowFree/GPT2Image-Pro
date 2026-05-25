import {
  GPT52_CHAT_MODEL,
  GPT53_CODEX_CHAT_MODEL,
  GPT53_CODEX_SPARK_CHAT_MODEL,
  GPT54_CHAT_MODEL,
  GPT54_MINI_CHAT_MODEL,
  GPT55_CHAT_MODEL,
  isPlanAtLeast,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { getPlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";
import { DEFAULT_IMAGE_MODEL } from "@/features/image-generation/resolution";

const DEFAULT_MODEL_OWNER = "gpt2image";

type OpenAIModel = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
};

export type OpenAIModelList = {
  object: "list";
  data: OpenAIModel[];
};

export function getExternalResponsesImageModels(
  plan: SubscriptionPlan,
  options?: { responsesAllowed?: boolean; gpt55Allowed?: boolean }
) {
  if (options?.responsesAllowed === false) {
    return [];
  }

  const models: string[] = [
    GPT54_CHAT_MODEL,
    GPT54_MINI_CHAT_MODEL,
    GPT52_CHAT_MODEL,
    GPT53_CODEX_CHAT_MODEL,
    GPT53_CODEX_SPARK_CHAT_MODEL,
  ];
  if (options?.gpt55Allowed ?? isPlanAtLeast(plan, "ultra")) {
    models.push(GPT55_CHAT_MODEL);
  }
  return models;
}

export async function isExternalResponsesImageModelAllowed(
  model: string | undefined,
  plan: SubscriptionPlan
) {
  const capabilities = await getPlanCapabilitySnapshot(plan);
  if (!capabilities.features["externalApi.responses"]) return false;
  if (!model) return true;
  return getExternalResponsesImageModels(plan, {
    responsesAllowed: capabilities.features["externalApi.responses"],
    gpt55Allowed: capabilities.features["models.gpt55"],
  }).includes(model.trim());
}

function toOpenAIModel(id: string): OpenAIModel {
  return {
    id,
    object: "model",
    created: 0,
    owned_by: DEFAULT_MODEL_OWNER,
  };
}

export async function getExternalModelsForUser(
  userId: string
): Promise<OpenAIModelList> {
  const plan = await getUserPlan(userId);
  const capabilities = await getPlanCapabilitySnapshot(plan.plan);
  const imageModels = [DEFAULT_IMAGE_MODEL];
  return {
    object: "list",
    data: [
      ...imageModels.map(toOpenAIModel),
      ...getExternalResponsesImageModels(plan.plan, {
        responsesAllowed: capabilities.features["externalApi.responses"],
        gpt55Allowed: capabilities.features["models.gpt55"],
      }).map(toOpenAIModel),
    ],
  };
}
