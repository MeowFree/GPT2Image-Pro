"use client";

import { getMyPlanAction } from "@repo/shared/subscription/actions/get-user-plan";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Switch } from "@repo/ui/components/switch";
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  deleteApiConfig,
  getApiConfig,
  saveApiConfig,
  toggleApiConfig,
} from "../actions";

type ActionError = {
  serverError?: string;
  validationErrors?: Record<string, unknown>;
};

function flattenValidationErrors(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenValidationErrors(item));
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap((item) => flattenValidationErrors(item));
  }
  return [];
}

function getActionErrorMessage(error?: ActionError) {
  const validationMessages = flattenValidationErrors(error?.validationErrors);
  if (validationMessages.length > 0) {
    return validationMessages.join(", ");
  }
  return error?.serverError || "Failed to save";
}

export function ApiConfigForm() {
  const t = useTranslations("Settings");
  const [expanded, setExpanded] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [useStream, setUseStream] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [hasConfig, setHasConfig] = useState(false);
  const [hasPaidPlan, setHasPaidPlan] = useState(false);
  const [loading, setLoading] = useState(true);

  const { execute: executeSave, isPending: isSaving } = useAction(
    saveApiConfig,
    {
      onSuccess: () => {
        toast.success("API configuration saved");
        setHasConfig(true);
      },
      onError: (err) => {
        toast.error(getActionErrorMessage(err.error));
      },
    }
  );

  const { execute: executeDelete, isPending: isDeleting } = useAction(
    deleteApiConfig,
    {
      onSuccess: () => {
        toast.success("API configuration removed");
        setBaseUrl("");
        setApiKey("");
        setModel("");
        setUseStream(false);
        setHasConfig(false);
      },
    }
  );

  const { execute: executeToggle } = useAction(toggleApiConfig, {
    onSuccess: () => {
      setIsActive(!isActive);
    },
    onError: (err) => {
      toast.error(err.error?.serverError || "Failed to update");
    },
  });

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [configResult, planResult] = await Promise.all([
          getApiConfig(),
          getMyPlanAction(),
        ]);
        setHasPaidPlan(Boolean(planResult?.data?.hasActiveSubscription));
        if (configResult?.data) {
          setBaseUrl(configResult.data.baseUrl);
          setApiKey(configResult.data.apiKey);
          setModel(configResult.data.model || "");
          setUseStream(Boolean(configResult.data.useStream));
          setIsActive(configResult.data.isActive);
          setHasConfig(true);
        }
      } catch {
        // No config exists
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleSave = () => {
    if (!hasPaidPlan) {
      toast.error("Custom API requires a paid subscription");
      return;
    }
    executeSave({
      baseUrl,
      apiKey,
      model: model || undefined,
      useStream,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground/80">
              {t("apiConfig.warning.title") || "Advanced Configuration"}
            </p>
            <p className="mt-1">
              {hasPaidPlan
                ? t("apiConfig.warning.description") ||
                  "Configure your own OpenAI-compatible API endpoint. When active, image generation will use your API key instead of platform credits."
                : "Custom API configuration is available for paid subscriptions only."}
            </p>
          </div>
        </div>
      </div>

      {/* Collapsible section */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <span>{t("apiConfig.customEndpoint") || "Custom API Endpoint"}</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          {/* Active toggle (only if config exists) */}
          {hasConfig && (
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">
                  {t("apiConfig.enabled") || "Use Custom API"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("apiConfig.enabledDescription") ||
                    "When enabled, bypasses platform credits"}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={(checked) =>
                  executeToggle({ isActive: checked })
                }
                disabled={!hasPaidPlan}
              />
            </div>
          )}

          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="api-base-url" className="text-sm">
              {t("apiConfig.baseUrl") || "API Base URL"}
            </Label>
            <Input
              id="api-base-url"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={!hasPaidPlan}
            />
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="api-key" className="text-sm">
              {t("apiConfig.apiKey") || "API Key"}
            </Label>
            <Input
              id="api-key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={!hasPaidPlan}
            />
          </div>

          {/* Model (optional) */}
          <div className="space-y-2">
            <Label htmlFor="api-model" className="text-sm">
              {t("apiConfig.model") || "Model (optional)"}
            </Label>
            <Input
              id="api-model"
              placeholder="gpt-image-2"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!hasPaidPlan}
            />
            <p className="text-xs text-muted-foreground">
              {t("apiConfig.modelHint") ||
                "Leave blank to use the default model"}
            </p>
          </div>

          {/* Streaming toggle */}
          <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-3">
            <div>
              <Label htmlFor="api-use-stream" className="text-sm">
                {t("apiConfig.useStream") || "Stream responses"}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("apiConfig.useStreamDescription") ||
                  "Send stream=true and accept New API image event streams."}
              </p>
            </div>
            <Switch
              id="api-use-stream"
              checked={useStream}
              onCheckedChange={setUseStream}
              disabled={!hasPaidPlan}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={!hasPaidPlan || !baseUrl || !apiKey || isSaving}
              size="sm"
            >
              {isSaving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              {t("apiConfig.save") || "Save Configuration"}
            </Button>
            {hasConfig && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => executeDelete()}
                disabled={isDeleting}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-3 w-3" />
                {t("apiConfig.remove") || "Remove"}
              </Button>
            )}
          </div>

          {/* Documentation link */}
          <a
            href="/docs"
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            {t("apiConfig.docsLink") || "API Documentation"}
          </a>
        </div>
      )}
    </div>
  );
}
