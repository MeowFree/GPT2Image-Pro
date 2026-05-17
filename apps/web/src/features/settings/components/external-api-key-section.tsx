"use client";

import { canUseExternalApi } from "@repo/shared/config/subscription-plan";
import { getMyPlanAction } from "@repo/shared/subscription/actions/get-user-plan";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Copy, KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createExternalApiKey,
  getExternalApiKeys,
  revokeExternalApiKey,
} from "../actions";

type ExternalApiKeySummary = {
  id: string;
  name: string;
  keyPrefix: string;
  lastFour: string;
  lastUsedAt: Date | string | null;
  isActive: boolean;
  createdAt: Date | string;
};

function formatDate(value: Date | string | null, emptyLabel: string) {
  if (!value) return emptyLabel;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ExternalApiKeySection() {
  const t = useTranslations("Settings.externalApi");
  const didLoadRef = useRef(false);
  const [keys, setKeys] = useState<ExternalApiKeySummary[]>([]);
  const [newKey, setNewKey] = useState("");
  const [keyName, setKeyName] = useState(t("defaultName"));
  const [loading, setLoading] = useState(true);
  const [externalApiAllowed, setExternalApiAllowed] = useState(false);

  const { execute: loadKeys, isPending: isRefreshing } = useAction(
    getExternalApiKeys,
    {
      onSuccess: ({ data }) => {
        setKeys(data || []);
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

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    loadKeys();
    getMyPlanAction().then((result) => {
      setExternalApiAllowed(
        result?.data?.plan ? canUseExternalApi(result.data.plan) : false
      );
    });
  }, [loadKeys]);

  const copyNewKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    toast.success(t("success.copied"));
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
          </div>
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
        <Button
          type="button"
          onClick={() => createKey({ name: keyName || undefined })}
          disabled={isCreating || !externalApiAllowed}
        >
          {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("create")}
        </Button>
      </div>

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
          keys.map((key) => (
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
                  {formatDate(key.lastUsedAt, t("never"))}
                </p>
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
