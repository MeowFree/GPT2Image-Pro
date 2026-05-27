"use client";

import {
  canUseExternalApi,
  getAllowedModerationBlockRiskLevels,
  type ModerationBlockRiskLevel,
  type SubscriptionPlan,
} from "@repo/shared/config/subscription-plan";
import { formatCredits } from "@repo/shared/credits/format";
import type { PlanCapabilitySnapshot } from "@repo/shared/subscription/services/plan-capabilities";
import { getMyPlanAction } from "@repo/shared/subscription/actions/get-user-plan";
import { formatDateInTimeZone } from "@repo/shared/time-zone";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import {
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createExternalApiKey,
  deleteExternalApiKey,
  getExternalApiKeys,
  revokeExternalApiKey,
  updateExternalApiKeyGroup,
  updateExternalApiKeyModeration,
  updateExternalApiKeyQuota,
} from "../actions";
import type { ImageBackendGroupBackendType } from "@/features/image-backend-pool/types";

type ImageBackendGroupOption = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isUserSelectable: boolean;
  isEnabled: boolean;
  contentSafetyEnabled: boolean | null;
  backendType: ImageBackendGroupBackendType;
  billingMultiplier?: number;
};

type ExternalApiKeySummary = {
  id: string;
  name: string;
  keyPrefix: string;
  lastFour: string;
  moderationBlockRiskLevel: ModerationBlockRiskLevel;
  generationGroupId: string | null;
  creditLimit: number | null;
  creditsUsed: number;
  lastUsedAt: Date | string | null;
  isActive: boolean;
  createdAt: Date | string;
};

function formatDate(
  value: Date | string | null,
  emptyLabel: string,
  locale: string,
  timeZone?: string
) {
  if (!value) return emptyLabel;
  return formatDateInTimeZone(value, locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }, timeZone);
}

function formatBillingMultiplier(value: number | null | undefined) {
  const multiplier = Number(value ?? 1);
  if (!Number.isFinite(multiplier) || multiplier <= 0) return "1";
  return Number(multiplier.toFixed(4)).toString();
}

function groupOptionLabel(group: ImageBackendGroupOption) {
  const backend =
    group.backendType === "web"
      ? "仅 Web"
      : group.backendType === "responses"
        ? "仅 Codex"
        : "混合";
  const safety =
    group.contentSafetyEnabled === true
      ? "内容审核开启"
      : group.contentSafetyEnabled === false
        ? "内容审核关闭"
        : "内容审核按成员配置";
  return `${group.name}${group.isDefault ? "（默认）" : ""} · ${backend} · ${safety} · 计费 x${formatBillingMultiplier(
    group.billingMultiplier
  )}`;
}

export function ExternalApiKeySection({ timeZone }: { timeZone?: string }) {
  const locale = useLocale();
  const t = useTranslations("Settings.externalApi");
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://gpt2image.superapi.buzz";
  const didLoadRef = useRef(false);
  const [keys, setKeys] = useState<ExternalApiKeySummary[]>([]);
  const [newKey, setNewKey] = useState("");
  const [keyName, setKeyName] = useState(t("defaultName"));
  const [newKeyModerationLevel, setNewKeyModerationLevel] =
    useState<ModerationBlockRiskLevel>("low");
  const [newKeyGroupId, setNewKeyGroupId] = useState("default");
  const [newKeyCreditLimit, setNewKeyCreditLimit] = useState("");
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<ImageBackendGroupOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [externalApiAllowed, setExternalApiAllowed] = useState(false);
  const [userPlan, setUserPlan] = useState<SubscriptionPlan>("free");
  const [capabilities, setCapabilities] =
    useState<PlanCapabilitySnapshot | null>(null);
  const moderationOptions =
    capabilities?.moderation.allowedBlockRiskLevels ||
    getAllowedModerationBlockRiskLevels(userPlan);
  const moderationOptionSet = new Set(moderationOptions);
  const moderationBlockingEnabled =
    capabilities?.features["moderation.blocking"] ?? true;
  const moderationControlAllowed =
    moderationBlockingEnabled && moderationOptions.length > 1;
  const defaultGroup = groups.find((group) => group.isDefault) ?? null;
  const newKeyGroup =
    newKeyGroupId === "default"
      ? defaultGroup
      : groups.find((group) => group.id === newKeyGroupId) ?? null;
  const resolveKeyGroup = (groupId: string | null) =>
    groupId
      ? groups.find((group) => group.id === groupId) ?? null
      : defaultGroup;

  const { execute: loadKeys, isPending: isRefreshing } = useAction(
    getExternalApiKeys,
    {
      onSuccess: ({ data }) => {
        const nextKeys = (data?.keys || []).map((key) => ({
            ...key,
            creditLimit:
              typeof key.creditLimit === "number" ? key.creditLimit : null,
            creditsUsed: Number(key.creditsUsed || 0),
            moderationBlockRiskLevel:
              key.moderationBlockRiskLevel === "medium" ||
              key.moderationBlockRiskLevel === "high"
                ? key.moderationBlockRiskLevel
                : ("low" as ModerationBlockRiskLevel),
          }));
        setKeys(nextKeys);
        setQuotaDrafts(
          Object.fromEntries(
            nextKeys.map((key) => [
              key.id,
              key.creditLimit === null ? "" : String(key.creditLimit),
            ])
          )
        );
        setGroups((data?.groups || []) as ImageBackendGroupOption[]);
        setLoading(false);
      },
      onError: ({ error }) => {
        toast.error(error.serverError || t("errors.load"));
        setLoading(false);
      },
    }
  );

  const { execute: createKey, isPending: isCreating } = useAction(
    createExternalApiKey,
    {
      onSuccess: ({ data }) => {
        if (data?.apiKey) {
          setNewKey(data.apiKey);
          setNewKeyCreditLimit("");
          toast.success(t("success.created"));
          loadKeys();
        }
      },
      onError: ({ error }) => {
        toast.error(error.serverError || t("errors.create"));
      },
    }
  );

  const { execute: revokeKey, isPending: isRevoking } = useAction(
    revokeExternalApiKey,
    {
      onSuccess: () => {
        toast.success(t("success.revoked"));
        loadKeys();
      },
      onError: ({ error }) => {
        toast.error(error.serverError || t("errors.revoke"));
      },
    }
  );

  const { execute: deleteKey, isPending: isDeleting } = useAction(
    deleteExternalApiKey,
    {
      onSuccess: () => {
        toast.success(t("success.deleted"));
        loadKeys();
      },
      onError: ({ error }) => {
        toast.error(error.serverError || t("errors.delete"));
      },
    }
  );

  const {
    execute: updateKeyModeration,
    isPending: isUpdatingModeration,
  } = useAction(updateExternalApiKeyModeration, {
    onSuccess: () => {
      toast.success(t("success.updated"));
      loadKeys();
    },
    onError: ({ error }) => {
      toast.error(error.serverError || t("errors.update"));
    },
  });

  const { execute: updateKeyGroup, isPending: isUpdatingGroup } = useAction(
    updateExternalApiKeyGroup,
    {
      onSuccess: () => {
        toast.success(t("success.updated"));
        loadKeys();
      },
      onError: ({ error }) => {
        toast.error(error.serverError || t("errors.update"));
      },
    }
  );

  const { execute: updateKeyQuota, isPending: isUpdatingQuota } = useAction(
    updateExternalApiKeyQuota,
    {
      onSuccess: () => {
        toast.success(t("success.quotaUpdated"));
        loadKeys();
      },
      onError: ({ error }) => {
        toast.error(error.serverError || t("errors.quota"));
      },
    }
  );

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    loadKeys();
    getMyPlanAction().then((result) => {
      const plan = result?.data?.plan || "free";
      setUserPlan(plan);
      setCapabilities(result?.data?.capabilities ?? null);
      setExternalApiAllowed(
        result?.data?.capabilities?.features["externalApi.keys.manage"] ??
          (result?.data?.plan ? canUseExternalApi(result.data.plan) : false)
      );
      const allowed =
        result?.data?.capabilities?.moderation.allowedBlockRiskLevels ||
        getAllowedModerationBlockRiskLevels(plan);
      setNewKeyModerationLevel(allowed.at(-1) || "low");
    });
  }, [loadKeys]);

  const copyNewKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    toast.success(t("success.copied"));
  };

  const parseQuotaLimit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric < 0) {
      toast.error(t("errors.quotaInvalid"));
      return undefined;
    }
    return numeric;
  };

  const saveKeyQuota = (keyId: string) => {
    const creditLimit = parseQuotaLimit(quotaDrafts[keyId] || "");
    if (creditLimit === undefined) return;
    updateKeyQuota({ id: keyId, creditLimit });
  };

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">{t("title")}</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("description")}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {t("baseUrl", { url: baseUrl })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("responsesRequiresPro")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("quota.description")}
          </p>
          {!moderationBlockingEnabled && (
            <p className="text-xs text-muted-foreground">
              {t("moderation.disabledByPlan")}
            </p>
          )}
          {!externalApiAllowed && (
            <p className="text-xs text-muted-foreground">
              {t("requiresStarter")}
            </p>
          )}
          <div className="space-y-1 font-mono text-xs text-muted-foreground">
            <p>GET /v1/models</p>
            <p>POST /v1/responses</p>
            <p>POST /v1/images/generations</p>
            <p>POST /v1/images/edits</p>
            <p>GET /v1/credits</p>
          </div>
          <Link
            href={`/${locale}/dashboard/backend-help`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            详细文档
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => loadKeys()}
          disabled={isRefreshing}
          aria-label={t("refresh")}
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {newKey && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <Label htmlFor="new-external-api-key" className="text-xs">
            {t("newKeyLabel")}
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="new-external-api-key"
              value={newKey}
              readOnly
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={copyNewKey}>
              <Copy className="mr-2 h-3 w-3" />
              复制
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={keyName}
          onChange={(event) => setKeyName(event.target.value)}
          placeholder={t("namePlaceholder")}
          className="sm:max-w-xs"
        />
        <Select
          value={newKeyModerationLevel}
          onValueChange={(value) =>
            setNewKeyModerationLevel(value as ModerationBlockRiskLevel)
          }
          disabled={!externalApiAllowed || !moderationControlAllowed}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder={t("moderation.label")} />
          </SelectTrigger>
          <SelectContent>
            {moderationOptions.map((level) => (
              <SelectItem key={level} value={level}>
                {t(`moderation.options.${level}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={newKeyGroupId}
          onValueChange={setNewKeyGroupId}
          disabled={!externalApiAllowed}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder={t("backendGroup.label")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">
              {defaultGroup
                ? `${t("backendGroup.default")} · ${groupOptionLabel(
                    defaultGroup
                  )}`
                : t("backendGroup.default")}
            </SelectItem>
            {groups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {groupOptionLabel(group)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={newKeyCreditLimit}
          onChange={(event) => setNewKeyCreditLimit(event.target.value)}
          placeholder={t("quota.createPlaceholder")}
          className="sm:max-w-40"
          disabled={!externalApiAllowed}
        />
        <Button
          type="button"
          onClick={() => {
            const creditLimit = parseQuotaLimit(newKeyCreditLimit);
            if (creditLimit === undefined) return;
            createKey({
              name: keyName || undefined,
              moderationBlockRiskLevel: newKeyModerationLevel,
              generationGroupId: newKeyGroupId,
              creditLimit,
            });
          }}
          disabled={isCreating || !externalApiAllowed}
        >
          {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("create")}
        </Button>
      </div>
      {newKeyGroup && (
        <p className="text-xs text-muted-foreground">
          {t("backendGroup.label")}: {groupOptionLabel(newKeyGroup)}
        </p>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : keys.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          keys.map((key) => {
            const selectedKeyGroup = resolveKeyGroup(key.generationGroupId);
            return (
              <div
                key={key.id}
                className="flex flex-col gap-3 rounded-md border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {key.name}
                  </span>
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {key.isActive ? t("active") : t("revoked")}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {key.keyPrefix}...{key.lastFour} · {t("lastUsed")}{" "}
                  {formatDate(key.lastUsedAt, t("never"), locale, timeZone)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("quota.used")}: {formatCredits(key.creditsUsed)} ·{" "}
                  {key.creditLimit === null
                    ? t("quota.unlimited")
                    : `${t("quota.remaining")}: ${formatCredits(
                        Math.max(0, key.creditLimit - key.creditsUsed)
                      )} / ${formatCredits(key.creditLimit)}`}
                </p>
                {selectedKeyGroup && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("backendGroup.label")}:{" "}
                    {groupOptionLabel(selectedKeyGroup)}
                  </p>
                )}
                <div className="mt-3 max-w-xs">
                  <Label htmlFor={`external-key-moderation-${key.id}`}>
                    {t("moderation.label")}
                  </Label>
                  <Select
                    value={
                      moderationOptionSet.has(key.moderationBlockRiskLevel)
                        ? key.moderationBlockRiskLevel
                        : moderationOptions.at(-1) || "low"
                    }
                    onValueChange={(value) =>
                      updateKeyModeration({
                        id: key.id,
                        moderationBlockRiskLevel:
                          value as ModerationBlockRiskLevel,
                      })
                    }
                    disabled={
                      !externalApiAllowed ||
                      !moderationControlAllowed ||
                      isUpdatingModeration
                    }
                  >
                    <SelectTrigger
                      id={`external-key-moderation-${key.id}`}
                      className="mt-1"
                    >
                      <SelectValue placeholder={t("moderation.label")} />
                    </SelectTrigger>
                    <SelectContent>
                      {moderationOptions.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t(`moderation.options.${level}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-3 max-w-xs">
                  <Label htmlFor={`external-key-group-${key.id}`}>
                    {t("backendGroup.label")}
                  </Label>
                  <Select
                    value={key.generationGroupId || "default"}
                    onValueChange={(value) =>
                      updateKeyGroup({
                        id: key.id,
                        generationGroupId: value,
                      })
                    }
                    disabled={!externalApiAllowed || isUpdatingGroup}
                  >
                    <SelectTrigger
                      id={`external-key-group-${key.id}`}
                      className="mt-1"
                    >
                      <SelectValue placeholder={t("backendGroup.label")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        {defaultGroup
                          ? `${t("backendGroup.default")} · ${groupOptionLabel(
                              defaultGroup
                            )}`
                          : t("backendGroup.default")}
                      </SelectItem>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {groupOptionLabel(group)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-3 flex max-w-xs items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor={`external-key-quota-${key.id}`}>
                      {t("quota.label")}
                    </Label>
                    <Input
                      id={`external-key-quota-${key.id}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={quotaDrafts[key.id] ?? ""}
                      onChange={(event) =>
                        setQuotaDrafts((current) => ({
                          ...current,
                          [key.id]: event.target.value,
                        }))
                      }
                      placeholder={t("quota.placeholder")}
                      className="mt-1"
                      disabled={!externalApiAllowed || isUpdatingQuota}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => saveKeyQuota(key.id)}
                    disabled={!externalApiAllowed || isUpdatingQuota}
                  >
                    {t("quota.save")}
                  </Button>
                </div>
              </div>
              {key.isActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => revokeKey({ id: key.id })}
                  disabled={isRevoking}
                >
                  <Trash2 className="mr-2 h-3 w-3" />
                  {t("revoke")}
                </Button>
              )}
              {!key.isActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    if (!window.confirm(t("confirmDelete"))) return;
                    deleteKey({ id: key.id });
                  }}
                  disabled={isDeleting}
                >
                  <Trash2 className="mr-2 h-3 w-3" />
                  {t("delete")}
                </Button>
              )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
