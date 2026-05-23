import type { SubscriptionPlan } from "@repo/shared/config/subscription-plan";

export type ImageBackendRequestKind =
  | "image_generation"
  | "image_edit"
  | "chat"
  | "responses";
export type ImageBackendAccountBackend = "web" | "responses";
export type ImageBackendGroupBackendType = "mixed" | "web" | "responses";
export type ImageBackendPreferenceMode = "always" | "mixed-only";
export type ImageBackendMemberType = "api" | "account";
export type ContentSafetyOverride = "inherit" | "enabled" | "disabled";

export type ImageBackendGroupSummary = {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  isUserSelectable: boolean;
  contentSafetyEnabled: boolean | null;
  backendType: ImageBackendGroupBackendType;
  minPlan: SubscriptionPlan;
  childGroupIds: string[];
  priority: number;
  apiCount: number;
  accountCount: number;
};
