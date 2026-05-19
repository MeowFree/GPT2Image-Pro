"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Progress } from "@repo/ui/components/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Switch } from "@repo/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Database,
  Loader2,
  Pencil,
  Plug,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  deleteImageBackendGroupAction,
  deleteImageBackendMemberAction,
  getAdminImageBackendPoolAction,
  getSub2ApiSourceGroupsAction,
  refreshImageBackendAccountInfoAction,
  saveImageBackendAccountAction,
  saveImageBackendApiAction,
  saveImageBackendGroupAction,
  syncImageBackendAccountsFromSub2ApiAction,
} from "./actions";

type Group = {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  isUserSelectable: boolean;
  contentSafetyEnabled: boolean | null;
  priority: number;
  apiCount: number;
  accountCount: number;
};

type Account = {
  id: string;
  groupId: string | null;
  name: string;
  email: string | null;
  implementationMode: string;
  model: string | null;
  contentSafetyEnabled: boolean;
  isEnabled: boolean;
  priority: number;
  concurrency: number;
  status: string;
  successCount: number;
  failCount: number;
  lastUsedAt: Date | string | null;
  cooldownUntil: Date | string | null;
  lastError: string | null;
  lastErrorAt: Date | string | null;
  metadata: {
    webAccount?: {
      email?: string | null;
      userId?: string | null;
      type?: string;
      quota?: number;
      imageQuotaUnknown?: boolean;
      defaultModelSlug?: string | null;
      restoreAt?: string | null;
      status?: "active" | "limited";
      refreshedAt?: string;
    };
  } | null;
};

type Api = {
  id: string;
  groupId: string | null;
  name: string;
  baseUrl: string;
  model: string | null;
  useStream: boolean;
  contentSafetyEnabled: boolean;
  isEnabled: boolean;
  priority: number;
  status: string;
  successCount: number;
  failCount: number;
  lastUsedAt: Date | string | null;
  cooldownUntil: Date | string | null;
  lastError: string | null;
  lastErrorAt: Date | string | null;
};

type ContentSafetyFormValue = "inherit" | "enabled" | "disabled";
type AccountBackendFormValue = "web" | "responses";
type TokenSyncMode = "web" | "responses" | "both";

type Sub2ApiSourceGroup = {
  id: string;
  name: string;
  platform: string | null;
  accountCount: number;
};

type SyncProgressState = {
  status: "idle" | "running" | "success" | "error";
  value: number;
  message: string;
};

function groupName(groups: Group[], groupId: string | null) {
  return groups.find((group) => group.id === groupId)?.name || "未分组";
}

function formatDate(value: Date | string | null) {
  if (!value) return "从未使用";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatOptionalDate(value: Date | string | null) {
  if (!value) return "无";
  return formatDate(value);
}

function isCoolingDown(value: Date | string | null) {
  return value ? new Date(value).getTime() > Date.now() : false;
}

function getWebAccountInfo(account: Account) {
  return account.implementationMode === "web"
    ? account.metadata?.webAccount
    : undefined;
}

function formatWebQuota(account: Account) {
  const info = getWebAccountInfo(account);
  if (!info) return "未刷新";
  if (info.type === "pro" || info.type === "prolite") return "∞";
  if (info.imageQuotaUnknown) return "未知";
  return String(Math.max(0, Number(info.quota || 0)));
}

function formatWebStatus(account: Account) {
  const info = getWebAccountInfo(account);
  if (!info) return null;
  return info.status === "limited" ? "额度受限" : "额度正常";
}

function safetyValue(value: boolean | null): ContentSafetyFormValue {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  return "inherit";
}

function normalizeBackendFormValue(value: string): AccountBackendFormValue {
  return value === "responses" ? "responses" : "web";
}

export function ImageBackendPoolAdminPanel() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [sub2ApiSourceGroups, setSub2ApiSourceGroups] = useState<
    Sub2ApiSourceGroup[]
  >([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [apis, setApis] = useState<Api[]>([]);
  const [groupForm, setGroupForm] = useState({
    id: "",
    name: "",
    description: "",
    isEnabled: true,
    isDefault: false,
    isUserSelectable: true,
    contentSafety: "inherit" as ContentSafetyFormValue,
    priority: 50,
  });
  const [accountForm, setAccountForm] = useState({
    id: "",
    groupId: "default",
    name: "",
    email: "",
    accessToken: "",
    refreshToken: "",
    implementationMode: "web" as AccountBackendFormValue,
    model: "",
    contentSafetyEnabled: true,
    isEnabled: true,
    priority: 50,
    concurrency: 1,
  });
  const [apiForm, setApiForm] = useState({
    id: "",
    groupId: "default",
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    useStream: false,
    contentSafetyEnabled: true,
    isEnabled: true,
    priority: 50,
  });
  const [importForm, setImportForm] = useState({
    sourceGroupId: "default",
    webGroupId: "default",
    responsesGroupId: "default",
    syncMode: "both" as TokenSyncMode,
    contentSafetyEnabled: true,
    limit: 100,
  });
  const [syncProgress, setSyncProgress] = useState<SyncProgressState>({
    status: "idle",
    value: 0,
    message: "等待开始同步",
  });

  const groupOptions = useMemo(
    () => [
      { id: "default", name: "未分组" },
      ...groups.map((group) => ({ id: group.id, name: group.name })),
    ],
    [groups]
  );

  const resetGroupForm = () =>
    setGroupForm({
      id: "",
      name: "",
      description: "",
      isEnabled: true,
      isDefault: false,
      isUserSelectable: true,
      contentSafety: "inherit" as ContentSafetyFormValue,
      priority: 50,
    });

  const resetAccountForm = () =>
    setAccountForm({
      id: "",
      groupId: "default",
      name: "",
      email: "",
      accessToken: "",
      refreshToken: "",
      implementationMode: "web" as AccountBackendFormValue,
      model: "",
      contentSafetyEnabled: true,
      isEnabled: true,
      priority: 50,
      concurrency: 1,
    });

  const resetApiForm = () =>
    setApiForm({
      id: "",
      groupId: "default",
      name: "",
      baseUrl: "",
      apiKey: "",
      model: "",
      useStream: false,
      contentSafetyEnabled: true,
      isEnabled: true,
      priority: 50,
    });

  const editGroup = (group: Group) => {
    setGroupForm({
      id: group.id,
      name: group.name,
      description: group.description || "",
      isEnabled: group.isEnabled,
      isDefault: group.isDefault,
      isUserSelectable: group.isUserSelectable,
      contentSafety: safetyValue(group.contentSafetyEnabled),
      priority: group.priority,
    });
  };

  const editAccount = (account: Account) => {
    setAccountForm({
      id: account.id,
      groupId: account.groupId || "default",
      name: account.name,
      email: account.email || "",
      accessToken: "",
      refreshToken: "",
      implementationMode: normalizeBackendFormValue(account.implementationMode),
      model: account.model || "",
      contentSafetyEnabled: account.contentSafetyEnabled,
      isEnabled: account.isEnabled,
      priority: account.priority,
      concurrency: account.concurrency,
    });
  };

  const editApi = (api: Api) => {
    setApiForm({
      id: api.id,
      groupId: api.groupId || "default",
      name: api.name,
      baseUrl: api.baseUrl,
      apiKey: "",
      model: api.model || "",
      useStream: api.useStream,
      contentSafetyEnabled: api.contentSafetyEnabled,
      isEnabled: api.isEnabled,
      priority: api.priority,
    });
  };

  const { execute: loadPool, isPending: isLoading } = useAction(
    getAdminImageBackendPoolAction,
    {
      onSuccess: ({ data }) => {
        setGroups((data?.groups || []) as Group[]);
        setAccounts((data?.accounts || []) as Account[]);
        setApis((data?.apis || []) as Api[]);
      },
      onError: ({ error }) => toast.error(error.serverError || "加载生图后端池失败"),
    }
  );

  const reload = () => loadPool();

  const { execute: loadSub2ApiSourceGroups, isPending: isLoadingSourceGroups } =
    useAction(getSub2ApiSourceGroupsAction, {
      onSuccess: ({ data }) => {
        setSub2ApiSourceGroups((data?.groups || []) as Sub2ApiSourceGroup[]);
      },
      onError: ({ error }) =>
        toast.error(error.serverError || "加载 Sub2API 来源分组失败"),
    });

  const { execute: saveGroup, isPending: isSavingGroup } = useAction(
    saveImageBackendGroupAction,
    {
      onSuccess: () => {
        toast.success("分组已保存");
        resetGroupForm();
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "保存分组失败"),
    }
  );

  const { execute: saveAccount, isPending: isSavingAccount } = useAction(
    saveImageBackendAccountAction,
    {
      onSuccess: () => {
        toast.success("账号已保存");
        resetAccountForm();
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "保存账号失败"),
    }
  );

  const { execute: saveApi, isPending: isSavingApi } = useAction(
    saveImageBackendApiAction,
    {
      onSuccess: () => {
        toast.success("API 后端已保存");
        resetApiForm();
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "保存 API 后端失败"),
    }
  );

  const { execute: syncSub2ApiAccounts, isPending: isSyncingSub2Api } = useAction(
    syncImageBackendAccountsFromSub2ApiAction,
    {
      onSuccess: ({ data }) => {
        const sourceCount = data?.sourceCount || 0;
        const syncedCount = data?.syncedCount || 0;
        const skippedCount =
          (data?.skipped?.web || 0) + (data?.skipped?.responses || 0);
        const failedCount = data?.failed || 0;
        setSyncProgress({
          status: "success",
          value: 100,
          message: `完成：读取 ${sourceCount} 个，写入 ${syncedCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个`,
        });
        toast.success(
          `已读取 ${sourceCount} 个 Sub2API 账号，同步 ${syncedCount} 个本地后端，回写 RT ${data?.refreshTokenWriteBackCount || 0} 个，跳过 ${skippedCount} 个`
        );
        reload();
      },
      onError: ({ error }) => {
        const message = error.serverError || "从 Sub2API 获取 AT 失败";
        setSyncProgress({
          status: "error",
          value: 100,
          message,
        });
        toast.error(message);
      },
    }
  );

  const { execute: deleteGroup, isPending: isDeletingGroup } = useAction(
    deleteImageBackendGroupAction,
    {
      onSuccess: () => {
        toast.success("分组已删除");
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "删除分组失败"),
    }
  );

  const { execute: deleteMember, isPending: isDeletingMember } = useAction(
    deleteImageBackendMemberAction,
    {
      onSuccess: () => {
        toast.success("后端已删除");
        reload();
      },
      onError: ({ error }) => toast.error(error.serverError || "删除后端失败"),
    }
  );

  const { execute: refreshAccountInfo, isPending: isRefreshingAccount } =
    useAction(refreshImageBackendAccountInfoAction, {
      onSuccess: ({ data }) => {
        const quota = data?.info?.imageQuotaUnknown
          ? "未知"
          : String(data?.info?.quota ?? 0);
        toast.success(`账号信息已刷新，图片额度 ${quota}`);
        reload();
      },
      onError: ({ error }) =>
        toast.error(error.serverError || "刷新账号远端信息失败"),
    });

  useEffect(() => {
    loadPool();
    loadSub2ApiSourceGroups();
  }, [loadPool, loadSub2ApiSourceGroups]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">生图后端池</h2>
          <p className="text-sm text-muted-foreground">
            管理自有账号池和系统后端 API。API 直连不转协议；Web 账号仅支持图片生成/编辑；Responses 账号支持 /responses，并可承接 images 到 responses 的转换。
          </p>
        </div>
        <Button variant="outline" onClick={reload} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          刷新
        </Button>
      </div>

      <Tabs defaultValue="groups" className="w-full">
        <TabsList className="h-auto flex-wrap justify-start bg-transparent p-0">
          <TabsTrigger value="groups">分组</TabsTrigger>
          <TabsTrigger value="accounts">账号池</TabsTrigger>
          <TabsTrigger value="apis">API 后端</TabsTrigger>
          <TabsTrigger value="import">获取 AT</TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {groupForm.id ? "编辑分组" : "新增分组"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="分组名称"
                value={groupForm.name}
                onChange={(event) =>
                  setGroupForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              <Textarea
                placeholder="说明"
                value={groupForm.description}
                onChange={(event) =>
                  setGroupForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <Label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={groupForm.isEnabled}
                    onCheckedChange={(checked) =>
                      setGroupForm((current) => ({
                        ...current,
                        isEnabled: Boolean(checked),
                      }))
                    }
                  />
                  启用
                </Label>
                <Label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={groupForm.isDefault}
                    onCheckedChange={(checked) =>
                      setGroupForm((current) => ({
                        ...current,
                        isDefault: Boolean(checked),
                      }))
                    }
                  />
                  默认
                </Label>
                <Label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={groupForm.isUserSelectable}
                    onCheckedChange={(checked) =>
                      setGroupForm((current) => ({
                        ...current,
                        isUserSelectable: Boolean(checked),
                      }))
                    }
                  />
                  用户可选
                </Label>
              </div>
              <div className="space-y-2">
                <Label>内容安全</Label>
                <Select
                  value={groupForm.contentSafety}
                  onValueChange={(value) =>
                    setGroupForm((current) => ({
                      ...current,
                      contentSafety: value as ContentSafetyFormValue,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">继承成员</SelectItem>
                    <SelectItem value="enabled">强制开启</SelectItem>
                    <SelectItem value="disabled">强制关闭</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                value={groupForm.priority}
                onChange={(event) =>
                  setGroupForm((current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
              />
              <Button
                className="w-full"
                onClick={() => saveGroup(groupForm)}
                disabled={isSavingGroup || !groupForm.name}
              >
                {isSavingGroup && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存分组
              </Button>
              {groupForm.id && (
                <Button variant="outline" className="w-full" onClick={resetGroupForm}>
                  取消编辑
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {groups.map((group) => (
              <Card key={group.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{group.name}</span>
                      {group.isDefault && <Badge>默认</Badge>}
                      {!group.isEnabled && <Badge variant="secondary">停用</Badge>}
                      {group.isUserSelectable && (
                        <Badge variant="outline">用户可选</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {group.description || "无说明"} · 优先级 {group.priority} · 账号 {group.accountCount} · API {group.apiCount}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => editGroup(group)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDeletingGroup}
                      onClick={() => deleteGroup({ id: group.id })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="accounts" className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {accountForm.id ? "编辑账号" : "新增账号"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="名称"
                value={accountForm.name}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              <Input
                placeholder="邮箱"
                value={accountForm.email}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, email: event.target.value }))
                }
              />
              <Textarea
                placeholder={
                  accountForm.id ? "Access Token，留空不修改" : "Access Token"
                }
                value={accountForm.accessToken}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    accessToken: event.target.value,
                  }))
                }
              />
              <Select
                value={accountForm.groupId}
                onValueChange={(value) =>
                  setAccountForm((current) => ({ ...current, groupId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={accountForm.implementationMode}
                onValueChange={(value) =>
                  setAccountForm((current) => ({
                    ...current,
                    implementationMode: value as AccountBackendFormValue,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web">Web 账号</SelectItem>
                  <SelectItem value="responses">Codex/Responses 账号</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="模型，可选"
                value={accountForm.model}
                onChange={(event) =>
                  setAccountForm((current) => ({ ...current, model: event.target.value }))
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  value={accountForm.priority}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      priority: Number(event.target.value),
                    }))
                  }
                />
                <Input
                  type="number"
                  value={accountForm.concurrency}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      concurrency: Number(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>接入内容安全审核</Label>
                <Switch
                  checked={accountForm.contentSafetyEnabled}
                  onCheckedChange={(checked) =>
                    setAccountForm((current) => ({
                      ...current,
                      contentSafetyEnabled: checked,
                    }))
                  }
                />
              </div>
              <Button
                className="w-full"
                onClick={() => saveAccount(accountForm)}
                disabled={
                  isSavingAccount ||
                  !accountForm.name ||
                  (!accountForm.id && !accountForm.accessToken)
                }
              >
                {isSavingAccount && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存账号
              </Button>
              {accountForm.id && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={resetAccountForm}
                >
                  取消编辑
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {accounts.map((account) => (
              <Card key={account.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{account.name}</span>
                      <Badge variant="outline">
                        {account.implementationMode === "responses"
                          ? "Codex/Responses"
                          : "Web"}
                      </Badge>
                      <Badge variant="secondary">{account.status}</Badge>
                      {formatWebStatus(account) && (
                        <Badge variant="secondary">
                          {formatWebStatus(account)}
                        </Badge>
                      )}
                      {isCoolingDown(account.cooldownUntil) && (
                        <Badge variant="secondary">冷却中</Badge>
                      )}
                      {!account.isEnabled && <Badge variant="secondary">停用</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {account.email || getWebAccountInfo(account)?.email || "无邮箱"} ·{" "}
                      {groupName(groups, account.groupId)} · 优先级{" "}
                      {account.priority} · {formatDate(account.lastUsedAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      成功 {account.successCount} · 失败 {account.failCount} · 冷却至{" "}
                      {formatOptionalDate(account.cooldownUntil)}
                    </p>
                    {account.implementationMode === "web" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Web 套餐 {getWebAccountInfo(account)?.type || "未刷新"} ·
                        图片额度 {formatWebQuota(account)} · 恢复{" "}
                        {formatOptionalDate(
                          getWebAccountInfo(account)?.restoreAt || null
                        )}{" "}
                        · 刷新{" "}
                        {formatOptionalDate(
                          getWebAccountInfo(account)?.refreshedAt || null
                        )}
                      </p>
                    )}
                    {account.lastError && (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">
                        {formatOptionalDate(account.lastErrorAt)} · {account.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {account.implementationMode === "web" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isRefreshingAccount}
                        onClick={() => refreshAccountInfo({ id: account.id })}
                      >
                        {isRefreshingAccount ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        刷新额度
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editAccount(account)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDeletingMember}
                      onClick={() =>
                        deleteMember({ type: "account", id: account.id })
                      }
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="apis" className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {apiForm.id ? "编辑 API 后端" : "新增 API 后端"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="名称"
                value={apiForm.name}
                onChange={(event) =>
                  setApiForm((current) => ({ ...current, name: event.target.value }))
                }
              />
              <Input
                placeholder="https://api.openai.com/v1"
                value={apiForm.baseUrl}
                onChange={(event) =>
                  setApiForm((current) => ({ ...current, baseUrl: event.target.value }))
                }
              />
              <Input
                type="password"
                placeholder={apiForm.id ? "API Key，留空不修改" : "API Key"}
                value={apiForm.apiKey}
                onChange={(event) =>
                  setApiForm((current) => ({ ...current, apiKey: event.target.value }))
                }
              />
              <Select
                value={apiForm.groupId}
                onValueChange={(value) =>
                  setApiForm((current) => ({ ...current, groupId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="默认模型，可选"
                value={apiForm.model}
                onChange={(event) =>
                  setApiForm((current) => ({ ...current, model: event.target.value }))
                }
              />
              <Input
                type="number"
                value={apiForm.priority}
                onChange={(event) =>
                  setApiForm((current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
              />
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>流式调用</Label>
                <Switch
                  checked={apiForm.useStream}
                  onCheckedChange={(checked) =>
                    setApiForm((current) => ({ ...current, useStream: checked }))
                  }
                />
              </div>
              <Button
                className="w-full"
                onClick={() => saveApi(apiForm)}
                disabled={
                  isSavingApi ||
                  !apiForm.name ||
                  !apiForm.baseUrl ||
                  (!apiForm.id && !apiForm.apiKey)
                }
              >
                {isSavingApi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                保存 API 后端
              </Button>
              {apiForm.id && (
                <Button variant="outline" className="w-full" onClick={resetApiForm}>
                  取消编辑
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3">
            {apis.map((api) => (
              <Card key={api.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Plug className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{api.name}</span>
                      <Badge variant="outline">API 直透</Badge>
                      <Badge variant="secondary">{api.status}</Badge>
                      {isCoolingDown(api.cooldownUntil) && (
                        <Badge variant="secondary">冷却中</Badge>
                      )}
                      {!api.isEnabled && <Badge variant="secondary">停用</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {api.baseUrl} · {groupName(groups, api.groupId)} · 优先级{" "}
                      {api.priority} · {formatDate(api.lastUsedAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      成功 {api.successCount} · 失败 {api.failCount} · 冷却至{" "}
                      {formatOptionalDate(api.cooldownUntil)}
                    </p>
                    {api.lastError && (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">
                        {formatOptionalDate(api.lastErrorAt)} · {api.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => editApi(api)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDeletingMember}
                      onClick={() => deleteMember({ type: "api", id: api.id })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="import" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                从 Sub2API 获取 AT
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                连接 Sub2API Postgres。Codex 直接复用 Sub2API 当前 access_token；Web 必须读取 Sub2API 的 RT 换取平台 AT，并把刷新返回的新 RT 写回 Sub2API，避免账号失效。
              </p>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Select
                  value={importForm.sourceGroupId}
                  onValueChange={(value) =>
                    setImportForm((current) => ({
                      ...current,
                      sourceGroupId: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sub2API 来源分组" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">全部 Sub2API OpenAI 账号</SelectItem>
                    {sub2ApiSourceGroups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name} · {group.accountCount} 个账号
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadSub2ApiSourceGroups()}
                  disabled={isLoadingSourceGroups}
                >
                  {isLoadingSourceGroups ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  刷新来源
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Select
                  value={importForm.syncMode}
                  onValueChange={(value) =>
                    setImportForm((current) => ({
                      ...current,
                      syncMode: value as TokenSyncMode,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">同时获取 Web 和 Codex AT</SelectItem>
                    <SelectItem value="web">只获取 Web AT</SelectItem>
                    <SelectItem value="responses">
                      只获取 Codex/Responses AT
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-between rounded-md border px-3">
                  <Label>接入内容安全审核</Label>
                  <Switch
                    checked={importForm.contentSafetyEnabled}
                    onCheckedChange={(checked) =>
                      setImportForm((current) => ({
                        ...current,
                        contentSafetyEnabled: checked,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Select
                  value={importForm.webGroupId}
                  onValueChange={(value) =>
                    setImportForm((current) => ({
                      ...current,
                      webGroupId: value,
                    }))
                  }
                  disabled={importForm.syncMode === "responses"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Web 账号分组" />
                  </SelectTrigger>
                  <SelectContent>
                    {groupOptions.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        Web：{group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={importForm.responsesGroupId}
                  onValueChange={(value) =>
                    setImportForm((current) => ({
                      ...current,
                      responsesGroupId: value,
                    }))
                  }
                  disabled={importForm.syncMode === "web"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Codex/Responses 账号分组" />
                  </SelectTrigger>
                  <SelectContent>
                    {groupOptions.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        Codex：{group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                min={1}
                max={500}
                value={importForm.limit}
                onChange={(event) =>
                  setImportForm((current) => ({
                    ...current,
                    limit: Number(event.target.value),
                  }))
                }
              />
              <div className="space-y-3">
                <Button
                  onClick={() => {
                    setSyncProgress({
                      status: "running",
                      value: 35,
                      message: "正在读取 Sub2API 账号并换取 AT",
                    });
                    syncSub2ApiAccounts({
                      sourceGroupId: importForm.sourceGroupId,
                      webGroupId: importForm.webGroupId,
                      responsesGroupId: importForm.responsesGroupId,
                      syncMode: importForm.syncMode,
                      contentSafetyEnabled: importForm.contentSafetyEnabled,
                      limit: importForm.limit,
                    });
                  }}
                  disabled={isSyncingSub2Api}
                >
                  {isSyncingSub2Api && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  获取 AT
                </Button>
                {(isSyncingSub2Api || syncProgress.status !== "idle") && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{syncProgress.message}</span>
                      <span className="text-muted-foreground">
                        {isSyncingSub2Api ? "同步中" : "已结束"}
                      </span>
                    </div>
                    <Progress
                      value={isSyncingSub2Api ? syncProgress.value : 100}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
