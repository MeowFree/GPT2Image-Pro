"use client";

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Loader2, RefreshCw } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getSelectableImageBackendGroupsAction,
  setUserImageBackendPreferenceAction,
} from "./actions";

type GroupOption = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  contentSafetyEnabled: boolean | null;
};

function safetyLabel(value: boolean | null) {
  if (value === true) return "内容审核开启";
  if (value === false) return "内容审核关闭";
  return "内容审核按成员配置";
}

export function ImageBackendPreferenceSection() {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("default");

  const { execute: loadGroups, isPending: isLoading } = useAction(
    getSelectableImageBackendGroupsAction,
    {
      onSuccess: ({ data }) => {
        setGroups((data?.groups || []) as GroupOption[]);
        setSelectedGroupId(data?.selectedGroupId || "default");
      },
      onError: ({ error }) => toast.error(error.serverError || "加载生图分组失败"),
    }
  );

  const { execute: savePreference, isPending: isSaving } = useAction(
    setUserImageBackendPreferenceAction,
    {
      onSuccess: () => toast.success("生图后端分组已保存"),
      onError: ({ error }) => toast.error(error.serverError || "保存生图分组失败"),
    }
  );

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-medium">生图后端分组</h4>
          <p className="text-xs text-muted-foreground">
            选择网页端和外接 API 默认使用的后端池。自接 API 仍按当前兼容策略优先使用。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => loadGroups()}
          disabled={isLoading}
          aria-label="刷新生图分组"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="image-backend-group">分组</Label>
          <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
            <SelectTrigger id="image-backend-group">
              <SelectValue placeholder="默认分组" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">默认分组</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                  {group.isDefault ? "（默认）" : ""}
                  {" · "}
                  {safetyLabel(group.contentSafetyEnabled)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          className="self-end"
          onClick={() => savePreference({ groupId: selectedGroupId })}
          disabled={isSaving}
        >
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          保存
        </Button>
      </div>
    </div>
  );
}
