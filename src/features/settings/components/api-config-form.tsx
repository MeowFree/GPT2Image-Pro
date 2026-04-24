"use client";

import { AlertTriangle, ChevronDown, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { deleteApiConfig, getApiConfig, saveApiConfig, toggleApiConfig } from "../actions";

export function ApiConfigForm() {
  const t = useTranslations("Settings");
  const [expanded, setExpanded] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [hasConfig, setHasConfig] = useState(false);
  const [loading, setLoading] = useState(true);

  const { execute: executeSave, isPending: isSaving } = useAction(saveApiConfig, {
    onSuccess: () => {
      toast.success("API configuration saved");
      setHasConfig(true);
    },
    onError: (err) => {
      toast.error(err.error?.serverError || "Failed to save");
    },
  });

  const { execute: executeDelete, isPending: isDeleting } = useAction(deleteApiConfig, {
    onSuccess: () => {
      toast.success("API configuration removed");
      setBaseUrl("");
      setApiKey("");
      setModel("");
      setHasConfig(false);
    },
  });

  const { execute: executeToggle } = useAction(toggleApiConfig, {
    onSuccess: () => {
      setIsActive(!isActive);
    },
  });

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const result = await getApiConfig({});
        if (result?.data) {
          setBaseUrl(result.data.baseUrl);
          setApiKey(result.data.apiKey);
          setModel(result.data.model || "");
          setIsActive(result.data.isActive);
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
    executeSave({ baseUrl, apiKey, model: model || undefined });
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
              {t("apiConfig.warning.description") || "Configure your own OpenAI-compatible API endpoint. When active, image generation will use your API key instead of platform credits."}
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
                <Label className="text-sm">{t("apiConfig.enabled") || "Use Custom API"}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("apiConfig.enabledDescription") || "When enabled, bypasses platform credits"}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={(checked) => executeToggle({ isActive: checked })}
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
            />
          </div>

          {/* Model (optional) */}
          <div className="space-y-2">
            <Label htmlFor="api-model" className="text-sm">
              {t("apiConfig.model") || "Model (optional)"}
            </Label>
            <Input
              id="api-model"
              placeholder="gpt-image-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("apiConfig.modelHint") || "Leave blank to use the default model"}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={!baseUrl || !apiKey || isSaving}
              className="bg-foreground text-background hover:bg-foreground/90"
              size="sm"
            >
              {isSaving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              {t("apiConfig.save") || "Save Configuration"}
            </Button>
            {hasConfig && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => executeDelete({})}
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
