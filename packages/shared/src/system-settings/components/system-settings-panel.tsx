"use client";

import { Download, Loader2, Save, Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Switch } from "@repo/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";

import {
  getSystemSettingsAction,
  importSystemSettingsFromEnvAction,
  updateSystemSettingsAction,
} from "../actions";
import { SETTING_CATEGORIES } from "../definitions";
import type {
  SettingCategory,
  SettingDefinition,
  SettingKey,
} from "../definitions";

type SettingSnapshotItem = SettingDefinition & {
  value: string;
  configured: boolean;
  stored: boolean;
  fromEnv: boolean;
  updatedAt: string | null;
};

type DraftValue = string | number | boolean;
type SettingUpdate = {
  key: string;
  value?: DraftValue;
  clear?: boolean;
};

function normalizeDraftValue(setting: SettingSnapshotItem): DraftValue {
  if (setting.valueType === "boolean") {
    if (setting.stored) return setting.value === "true";
    return Boolean(setting.defaultValue);
  }
  if (setting.valueType === "number") {
    if (setting.stored && setting.value !== "") return Number(setting.value);
    return typeof setting.defaultValue === "number" ? setting.defaultValue : "";
  }
  return setting.value || "";
}

function toSubmitValue(setting: SettingSnapshotItem, value: DraftValue) {
  if (setting.valueType === "boolean") return Boolean(value);
  if (setting.valueType === "number") return Number(value);
  return String(value ?? "");
}

function SettingInput({
  setting,
  value,
  disabled,
  onChange,
}: {
  setting: SettingSnapshotItem;
  value: DraftValue;
  disabled: boolean;
  onChange: (value: DraftValue) => void;
}) {
  if (setting.valueType === "boolean") {
    return (
      <Switch
        checked={Boolean(value)}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    );
  }

  if (setting.valueType === "select") {
    return (
      <Select
        value={String(value || "")}
        disabled={disabled}
        onValueChange={onChange}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          {(setting.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      type={setting.valueType === "number" ? "number" : "text"}
      value={String(value)}
      placeholder={setting.secret && setting.configured ? "已配置，留空不修改" : ""}
      disabled={disabled}
      onChange={(event) =>
        onChange(
          setting.valueType === "number"
            ? event.target.value
            : event.target.value
        )
      }
    />
  );
}

export function SystemSettingsPanel() {
  const [settings, setSettings] = useState<SettingSnapshotItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [clearKeys, setClearKeys] = useState<Record<string, boolean>>({});

  const {
    execute: loadSettings,
    result: settingsResult,
    isPending: isLoading,
  } = useAction(getSystemSettingsAction);
  const { execute: saveSettings, isPending: isSaving } = useAction(
    updateSystemSettingsAction,
    {
      onSuccess: ({ data }) => {
        if (data?.message) toast.success(data.message);
        loadSettings();
      },
      onError: ({ error }) => {
        toast.error(error.serverError || "系统设置保存失败");
      },
    }
  );
  const { execute: importEnvSettings, isPending: isImporting } = useAction(
    importSystemSettingsFromEnvAction,
    {
      onSuccess: ({ data }) => {
        if (data?.message) toast.success(data.message);
        loadSettings();
      },
      onError: ({ error }) => {
        toast.error(error.serverError || "导入环境变量失败");
      },
    }
  );

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const loaded = (settingsResult.data?.settings ?? []) as SettingSnapshotItem[];
    if (!loaded.length) return;
    setSettings(loaded);
    setDrafts(
      Object.fromEntries(
        loaded.map((setting) => [setting.key, normalizeDraftValue(setting)])
      )
    );
    setClearKeys({});
  }, [settingsResult.data?.settings]);

  const settingsByCategory = useMemo(() => {
    const map = new Map<SettingCategory, SettingSnapshotItem[]>();
    for (const category of SETTING_CATEGORIES) {
      map.set(category.id, []);
    }
    for (const setting of settings) {
      map.get(setting.category)?.push(setting);
    }
    return map;
  }, [settings]);

  const handleSave = () => {
    const payload: SettingUpdate[] = [];
    for (const setting of settings) {
      if (clearKeys[setting.key]) {
        payload.push({ key: setting.key, clear: true });
        continue;
      }
      const value = drafts[setting.key];
      if (
        setting.secret &&
        typeof value === "string" &&
        value.trim() === ""
      ) {
        continue;
      }
      payload.push({
        key: setting.key,
        value: toSubmitValue(setting, value ?? ""),
      });
    }

    if (payload.length === 0) {
      toast.info("没有需要保存的改动");
      return;
    }

    saveSettings({ settings: payload });
  };

  const updateDraft = (key: SettingKey, value: DraftValue) => {
    setDrafts((current) => ({ ...current, [key]: value }));
    setClearKeys((current) => ({ ...current, [key]: false }));
  };

  const markClear = (key: SettingKey) => {
    setDrafts((current) => ({ ...current, [key]: "" }));
    setClearKeys((current) => ({ ...current, [key]: true }));
  };

  const disabled = isLoading || isSaving || isImporting;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">系统设置</h2>
          <p className="text-sm text-muted-foreground">
            管理审核、登录、支付、套餐、模型、存储和邮件等全局配置。密钥不会在页面回显。
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => importEnvSettings({ overwrite: true })}
            disabled={disabled}
          >
            {isImporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            导入当前环境变量
          </Button>
          <Button onClick={handleSave} disabled={disabled || settings.length === 0}>
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            保存设置
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        已保存配置优先于环境变量；未保存时继续使用环境变量兜底。标记为“需重启”或“需重新构建”的配置，保存后要重启服务或重新部署后才完整生效。
      </div>

      <Tabs defaultValue={SETTING_CATEGORIES[0]?.id ?? "general"} className="w-full">
        <TabsList className="h-auto flex-wrap justify-start bg-transparent p-0">
          {SETTING_CATEGORIES.map((category) => (
            <TabsTrigger
              key={category.id}
              value={category.id}
              className="rounded-md border border-transparent px-3 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground/5 data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {category.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {SETTING_CATEGORIES.map((category) => {
          const categorySettings = settingsByCategory.get(category.id) ?? [];
          return (
            <TabsContent
              key={category.id}
              value={category.id}
              className="mt-6 space-y-4"
            >
              <div>
                <h3 className="text-lg font-semibold">{category.label}</h3>
                <p className="text-sm text-muted-foreground">
                  {category.description}
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {categorySettings.map((setting) => (
                  <Card key={setting.key} className="rounded-lg">
                    <CardHeader className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle className="text-base">
                          {setting.label}
                        </CardTitle>
                        <div className="flex flex-wrap justify-end gap-1">
                          {setting.secret && (
                            <Badge variant="secondary">密钥</Badge>
                          )}
                          {setting.stored ? (
                            <Badge>后台</Badge>
                          ) : setting.fromEnv ? (
                            <Badge variant="secondary">环境变量</Badge>
                          ) : (
                            <Badge variant="outline">未配置</Badge>
                          )}
                          {setting.requiresRestart && (
                            <Badge variant="outline">需重启</Badge>
                          )}
                          {setting.requiresRebuild && (
                            <Badge variant="outline">需重新构建</Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {setting.description}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor={`setting-${setting.key}`}>
                          {setting.key}
                        </Label>
                        <div className="flex items-center gap-2">
                          <div
                            id={`setting-${setting.key}`}
                            className="flex-1"
                          >
                            <SettingInput
                              setting={setting}
                              value={drafts[setting.key] ?? ""}
                              disabled={disabled}
                              onChange={(value) =>
                                updateDraft(setting.key, value)
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={disabled || !setting.configured}
                            title="清空后台配置"
                            onClick={() => markClear(setting.key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {clearKeys[setting.key] && (
                        <p className="text-xs text-destructive">
                          保存后将清空此项的后台配置，环境变量兜底仍可能生效。
                        </p>
                      )}
                      {setting.updatedAt && (
                        <p className="text-xs text-muted-foreground">
                          最近更新:{" "}
                          {new Date(setting.updatedAt).toLocaleString("zh-CN")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
