import {
  canUseExternalResponsesImageApi,
  canUseGpt55Chat,
  GPT52_CHAT_MODEL,
  GPT54_CHAT_MODEL,
  GPT54_MINI_CHAT_MODEL,
  GPT55_CHAT_MODEL,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { getUserPlan } from "@repo/shared/subscription/services/user-plan";

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

export function getExternalResponsesImageModels(plan: SubscriptionPlan) {
  if (!canUseExternalResponsesImageApi(plan)) {
    return [];
  }

  const models: string[] = [
    GPT54_CHAT_MODEL,
    GPT54_MINI_CHAT_MODEL,
    GPT52_CHAT_MODEL,
  ];
  if (canUseGpt55Chat(plan)) {
    models.push(GPT55_CHAT_MODEL);
  }
  return models;
}

export function isExternalResponsesImageModelAllowed(
  model: string | undefined,
  plan: SubscriptionPlan
) {
  if (!canUseExternalResponsesImageApi(plan)) return false;
  if (!model) return true;
  return getExternalResponsesImageModels(plan).includes(model.trim());
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
  return {
    object: "list",
    data: getExternalResponsesImageModels(plan.plan).map(toOpenAIModel),
  };
}
