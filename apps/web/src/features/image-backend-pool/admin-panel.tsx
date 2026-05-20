"use client";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Checkbox } from "@repo/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Database,
  ExternalLink,
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
import type { SubscriptionPlan } from "@repo/shared/config/subscription-plan";

import {
  bulkDeleteImageBackendAccountsAction,
  bulkUpdateImageBackendAccountsAction,
  deleteImageBackendGroupAction,
  deleteImageBackendMemberAction,
  getAdminImageBackendPoolAction,
  getSub2ApiSourceGroupsAction,
  importImageBackendAccountsFromRefreshTokensAction,
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
  minPlan: SubscriptionPlan;
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
    source?: string;
    sourceAccountId?: string;
    tokenSource?: string;
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

type BulkAccountForm = {
  selectionGroupId: string;
  selectionMode: "all" | AccountBackendFormValue;
  setGroup: boolean;
  groupId: string;
  setMode: boolean;
  implementationMode: AccountBackendFormValue;
  setEnabled: boolean;
  isEnabled: boolean;
  setContentSafety: boolean;
  contentSafetyEnabled: boolean;
  deleteSelected: boolean;
};

const PLAN_OPTIONS: Array<{ value: SubscriptionPlan; label: string }> = [
  { value: "free", label: "不限门槛" },
  { value: "starter", label: "入门版" },
  { value: "pro", label: "专业版" },
  { value: "ultra", label: "旗舰版" },
  { value: "enterprise", label: "企业版" },
];

function groupName(groups: Group[], groupId: string | null) {
  return groups.find((group) => group.id === groupId)?.name || "未分组";
}

function planLabel(plan: SubscriptionPlan) {
  return PLAN_OPTIONS.find((option) => option.value === plan)?.label || plan;
}

function safetyLabel(value: boolean | null) {
  if (value === true) return "内容安全强制开启";
  if (value === false) return "内容安全强制关闭";
  return "内容安全继承成员";
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

function formatCooldown(value: Date | string | null) {
  if (!value) return "无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "无";

  const remainingMs = date.getTime() - Date.now();
  if (remainingMs <= 0) return `${formatDate(value)} · 已到期`;

  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}天`);
  if (hours) parts.push(`${hours}小时`);
  if (minutes || !parts.length) parts.push(`${minutes}分钟`);

  return `${formatDate(value)} · 剩余 ${parts.slice(0, 2).join("")}`;
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

function accountSourceLabel(account: Account) {
  const source = account.metadata?.source;
  if (source === "sub2api_postgres") return "Sub2API";
  if (source === "manual_refresh_token") return "手工 RT";
  return "本站";
}

function isSub2ApiAccount(account: Account | undefined) {
  return account?.metadata?.source === "sub2api_postgres";
}

function formatModeStats(
  label: string,
  stats: { synced: number; skipped: number; failed: number }
) {
  return `${label} 写入 ${stats.synced}，跳过 ${stats.skipped}，失败 ${stats.failed}`;
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
    minPlan: "free" as SubscriptionPlan,
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
  const [bulkAccountForm, setBulkAccountForm] = useState<BulkAccountForm>({
    selectionGroupId: "all",
    selectionMode: "all" as "all" | AccountBackendFormValue,
    setGroup: false,
    groupId: "default",
    setMode: false,
    implementationMode: "responses" as AccountBackendFormValue,
    setEnabled: false,
    isEnabled: true,
    setContentSafety: false,
    contentSafetyEnabled: true,
    deleteSelected: false,
  } satisfies BulkAccountForm);
  const [manualImportForm, setManualImportForm] = useState({
    refreshTokensText: "",
    webGroupId: "default",
    responsesGroupId: "default",
    syncMode: "responses" as TokenSyncMode,
    useMobileRt: false,
    namePrefix: "手工导入",
    model: "",
    contentSafetyEnabled: true,
    priority: 50,
    concurrency: 1,
  });
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [isManualImportOpen, setIsManualImportOpen] = useState(false);
  const [importForm, setImportForm] = useState({
    sourceGroupId: "default",
    webGroupId: "default",
    responsesGroupId: "default",
    syncMode: "responses" as TokenSyncMode,
    allowMobileRtImport: false,
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
  const selectedAccountIdSet = useMemo(
    () => new Set(selectedAccountIds),
    [selectedAccountIds]
  );
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedAccountIdSet.has(account.id)),
    [accounts, selectedAccountIdSet]
  );
  const selectedSub2ApiAccountCount = selectedAccounts.filter((account) =>
    isSub2ApiAccount(account)
  ).length;
  const selectedManualAccountCount =
    selectedAccounts.length - selectedSub2ApiAccountCount;
  const selectedAccountCount = selectedAccountIds.length;
  const allAccountsSelected =
    accounts.length > 0 && selectedAccountIds.length === accounts.length;
  const hasBulkAccountOperation =
    bulkAccountForm.setGroup ||
    bulkAccountForm.setMode ||
    bulkAccountForm.setEnabled ||
    bulkAccountForm.setContentSafety ||
    bulkAccountForm.deleteSelected;
  const editingAccount = accountForm.id
    ? accounts.find((account) => account.id === accountForm.id)
    : undefined;
  const editingSub2ApiAccount = isSub2ApiAccount(editingAccount);
  const effectiveImportSyncMode = importForm.allowMobileRtImport
    ? importForm.syncMode
    : ("responses" as TokenSyncMode);
  const effectiveManualImportSyncMode = manualImportForm.useMobileRt
    ? manualImportForm.syncMode
    : ("responses" as TokenSyncMode);
  const authSessionUrl = "https://chatgpt.com/api/auth/session";

  const resetGroupForm = () =>
    setGroupForm({
      id: "",
      name: "",
      description: "",
      isEnabled: true,
      isDefault: false,
      isUserSelectable: true,
      contentSafety: "inherit" as ContentSafetyFormValue,
      minPlan: "free" as SubscriptionPlan,
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

  const resetManualImportForm = () =>
    setManualImportForm({
      refreshTokensText: "",
      webGroupId: "default",
      responsesGroupId: "default",
      syncMode: "responses" as TokenSyncMode,
      useMobileRt: false,
      namePrefix: "手工导入",
      model: "",
      contentSafetyEnabled: true,
      priority: 50,
      concurrency: 1,
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
      minPlan: group.minPlan || "free",
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

  const toggleAccountSelection = (accountId: string, checked: boolean) => {
    setSelectedAccountIds((current) =>
      checked
        ? Array.from(new Set([...current, accountId]))
        : current.filter((id) => id !== accountId)
    );
  };

  const toggleAllAccounts = (checked: boolean) => {
    setSelectedAccountIds(checked ? accounts.map((account) => account.id) : []);
  };

  const selectAccountsByCurrentFilter = () => {
    const matched = accounts.filter((account) => {
      const groupMatches =
        bulkAccountForm.selectionGroupId === "all" ||
        (bulkAccountForm.selectionGroupId === "default"
          ? !account.groupId
          : account.groupId === bulkAccountForm.selectionGroupId);
      const modeMatches =
        bulkAccountForm.selectionMode === "all" ||
        account.implementationMode === bulkAccountForm.selectionMode;
      return groupMatches && modeMatches;
    });
    setSelectedAccountIds(matched.map((account) => account.id));
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
        setSelectedAccountIds((current) => {
          const availableIds = new Set(
            (data?.accounts || []).map((account) => account.id)
          );
          return current.filter((id) => availableIds.has(id));
        });
      },
      onError: ({ error }) =>
        toast.error(error.serverError || "加载生图后端池失败"),
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

  const { execute: bulkUpdateAccounts, isPending: isBulkUpdatingAccounts } =
    useAction(bulkUpdateImageBackendAccountsAction, {
      onSuccess: ({ data }) => {
        toast.success(
          `批量操作完成：成功 ${data?.updatedCount || 0} 个，失败 ${
            data?.failedCount || 0
          } 个`
        );
        setSelectedAccountIds([]);
        reload();
      },
      onError: ({ error }) =>
        toast.error(error.serverError || "批量操作账号失败"),
    });

  const { execute: bulkDeleteAccounts, isPending: isBulkDeletingAccounts } =
    useAction(bulkDeleteImageBackendAccountsAction, {
      onSuccess: ({ data }) => {
        toast.success(`已删除 ${data?.deletedCount || 0} 个账号`);
        setSelectedAccountIds([]);
        reload();
      },
      onError: ({ error }) =>
        toast.error(error.serverError || "批量删除账号失败"),
    });

  const {
    execute: importManualRefreshTokens,
    isPending: isImportingManualRefreshTokens,
  } = useAction(importImageBackendAccountsFromRefreshTokensAction, {
    onSuccess: ({ data }) => {
      toast.success(
        `导入完成：提取 RT ${data?.sourceCount || 0} 个，写入 ${
          data?.syncedCount || 0
        } 个，失败 ${data?.failed || 0} 个`
      );
      setIsManualImportOpen(false);
      resetManualImportForm();
      reload();
    },
    onError: ({ error }) =>
      toast.error(error.serverError || "手工 RT 导入失败"),
  });

  const { execute: saveApi, isPending: isSavingApi } = useAction(
    saveImageBackendApiAction,
    {
      onSuccess: () => {
        toast.success("API 后端已保存");
        resetApiForm();
        reload();
      },
      onError: ({ error }) =>
        toast.error(error.serverError || "保存 API 后端失败"),
    }
  );

  const { executeAsync: syncSub2ApiAccountsBatch } = useAction(
    syncImageBackendAccountsFromSub2ApiAction
  );
  const [isSyncingSub2Api, setIsSyncingSub2Api] = useState(false);

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

  const runSub2ApiSync = async () => {
    if (isSyncingSub2Api) return;
    setIsSyncingSub2Api(true);

    const batchSize = Math.max(
      1,
      Math.min(100, Math.trunc(importForm.limit || 100))
    );
    let offset = 0;
    let totalSourceCount = 0;
    let processedCount = 0;
    let syncedCount = 0;
    let failedCount = 0;
    const synced = { web: 0, responses: 0 };
    const skipped = { web: 0, responses: 0 };
    const failed = { web: 0, responses: 0 };

    setSyncProgress({
      status: "running",
      value: 5,
      message: "正在读取 Sub2API 账号",
    });

    try {
      for (;;) {
        const result = await syncSub2ApiAccountsBatch({
          sourceGroupId: importForm.sourceGroupId,
          webGroupId: importForm.webGroupId,
          responsesGroupId: importForm.responsesGroupId,
          syncMode: effectiveImportSyncMode,
          allowMobileRtImport: importForm.allowMobileRtImport,
          contentSafetyEnabled: importForm.contentSafetyEnabled,
          limit: batchSize,
          offset,
        });

        if (result?.serverError) {
          throw new Error(result.serverError);
        }
        if (!result?.data?.success) {
          throw new Error("从 Sub2API 获取 AT 失败");
        }

        const data = result.data;
        totalSourceCount = data.totalSourceCount || totalSourceCount;
        processedCount = data.nextOffset || processedCount + data.sourceCount;
        syncedCount += data.syncedCount || 0;
        failedCount += data.failed || 0;
        synced.web += data.syncedByMode?.web || 0;
        synced.responses += data.syncedByMode?.responses || 0;
        skipped.web += data.skipped?.web || 0;
        skipped.responses += data.skipped?.responses || 0;
        failed.web += data.failedByMode?.web || 0;
        failed.responses += data.failedByMode?.responses || 0;

        const progressBase = totalSourceCount
          ? Math.min(100, Math.round((processedCount / totalSourceCount) * 100))
          : data.hasMore
            ? 50
            : 100;
        const progressValue = Math.max(5, Math.min(99, progressBase));
        const codexText = formatModeStats("Codex", {
          synced: synced.responses,
          skipped: skipped.responses,
          failed: failed.responses,
        });
        const webText = formatModeStats("Web", {
          synced: synced.web,
          skipped: skipped.web,
          failed: failed.web,
        });
        setSyncProgress({
          status: "running",
          value: data.hasMore ? progressValue : 100,
          message: `来源账号 ${processedCount}/${totalSourceCount || "?"}；${codexText}；${webText}`,
        });

        if (!data.hasMore || data.sourceCount === 0) break;
        offset = data.nextOffset || offset + data.sourceCount;
      }

      const skippedCount = skipped.web + skipped.responses;
      setSyncProgress({
        status: "success",
        value: 100,
        message: `完成：来源账号 ${processedCount} 个；${formatModeStats(
          "Codex",
          {
            synced: synced.responses,
            skipped: skipped.responses,
            failed: failed.responses,
          }
        )}；${formatModeStats("Web", {
          synced: synced.web,
          skipped: skipped.web,
          failed: failed.web,
        })}`,
      });
      toast.success(
        `同步完成：写入 ${syncedCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个`
      );
      reload();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "从 Sub2API 获取 AT 失败";
      setSyncProgress({
        status: "error",
        value: 100,
        message,
      });
      toast.error(message);
    } finally {
      setIsSyncingSub2Api(false);
    }
  };

  const runBulkAccountOperation = () => {
    if (!selectedAccountIds.length) {
      toast.error("请先选择账号");
      return;
    }
    if (!hasBulkAccountOperation) {
      toast.error("请选择至少一个批量操作");
      return;
    }
    if (
      bulkAccountForm.deleteSelected &&
      !window.confirm(
        `确定删除 ${selectedAccountIds.length} 个账号？这只会删除本站后端池记录，不会删除 Sub2API 源库账号。`
      )
    ) {
      return;
    }
    if (bulkAccountForm.setMode && selectedSub2ApiAccountCount > 0) {
      toast.error("Sub2API 同步账号不能在本站批量切换 Web/Responses");
      return;
    }
    if (bulkAccountForm.deleteSelected) {
      bulkDeleteAccounts({ accountIds: selectedAccountIds });
      return;
    }

    bulkUpdateAccounts({
      accountIds: selectedAccountIds,
      ...(bulkAccountForm.setGroup ? { groupId: bulkAccountForm.groupId } : {}),
      ...(bulkAccountForm.setMode
        ? { implementationMode: bulkAccountForm.implementationMode }
        : {}),
      ...(bulkAccountForm.setEnabled
        ? { isEnabled: bulkAccountForm.isEnabled }
        : {}),
      ...(bulkAccountForm.setContentSafety
        ? { contentSafetyEnabled: bulkAccountForm.contentSafetyEnabled }
        : {}),
    });
  };

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
            管理自有账号池和系统后端 API。API 直连不转协议；Web
            账号仅支持图片生成/编辑；Responses 账号支持 /responses，并可承接
            images 到 responses 的转换。
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

        <TabsContent
          value="groups"
          className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]"
        >
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
                  setGroupForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
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
              <div className="space-y-2">
                <Label>最低套餐</Label>
                <Select
                  value={groupForm.minPlan}
                  onValueChange={(value) =>
                    setGroupForm((current) => ({
                      ...current,
                      minPlan: value as SubscriptionPlan,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  用户套餐低于该档位时不可选择此后端分组，外接 API Key
                  也不能绑定。
                </p>
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
                {isSavingGroup && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                保存分组
              </Button>
              {groupForm.id && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={resetGroupForm}
                >
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
                      {!group.isEnabled && (
                        <Badge variant="secondary">停用</Badge>
                      )}
                      {group.isUserSelectable && (
                        <Badge variant="outline">用户可选</Badge>
                      )}
                      <Badge variant="outline">
                        最低 {planLabel(group.minPlan)}
                      </Badge>
                      <Badge
                        variant={
                          group.contentSafetyEnabled === false
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {safetyLabel(group.contentSafetyEnabled)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {group.description || "无说明"} · 优先级 {group.priority}{" "}
                      · 账号 {group.accountCount} · API {group.apiCount}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editGroup(group)}
                    >
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

        <TabsContent
          value="accounts"
          className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]"
        >
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
                  setAccountForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="邮箱"
                value={accountForm.email}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
              <Textarea
                placeholder={
                  accountForm.id
                    ? "Access Token，留空不修改"
                    : "Access Token，可选；优先使用 RT 自动换取"
                }
                value={accountForm.accessToken}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    accessToken: event.target.value,
                  }))
                }
              />
              {!editingSub2ApiAccount ? (
                <Textarea
                  placeholder={
                    accountForm.id
                      ? "Refresh Token，留空不修改；填写后会重新换取 AT"
                      : "Refresh Token，推荐填写；保存时自动换取 AT"
                  }
                  value={accountForm.refreshToken}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      refreshToken: event.target.value,
                    }))
                  }
                />
              ) : (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Sub2API 来源账号的 RT 由 Sub2API 管理，本站不允许修改。
                </div>
              )}
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
                  <SelectItem value="responses">
                    Codex/Responses 账号
                  </SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="模型，可选"
                value={accountForm.model}
                onChange={(event) =>
                  setAccountForm((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
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
                  (!accountForm.id &&
                    !accountForm.accessToken &&
                    !accountForm.refreshToken)
                }
              >
                {isSavingAccount && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
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
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <Label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allAccountsSelected}
                      onCheckedChange={(checked) =>
                        toggleAllAccounts(Boolean(checked))
                      }
                    />
                    已选 {selectedAccountCount} 个账号
                    {selectedAccountCount > 0 && (
                      <span className="text-muted-foreground">
                        Sub2API {selectedSub2ApiAccountCount} · 手工/本站{" "}
                        {selectedManualAccountCount}
                      </span>
                    )}
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsManualImportOpen(true)}
                  >
                    批量导入 RT
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
                  <Select
                    value={bulkAccountForm.selectionGroupId}
                    onValueChange={(value) =>
                      setBulkAccountForm((current) => ({
                        ...current,
                        selectionGroupId: value,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="按分组选择" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部分组</SelectItem>
                      {groupOptions.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={bulkAccountForm.selectionMode}
                    onValueChange={(value) =>
                      setBulkAccountForm((current) => ({
                        ...current,
                        selectionMode: value as "all" | AccountBackendFormValue,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="按接口选择" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部接口</SelectItem>
                      <SelectItem value="web">Web</SelectItem>
                      <SelectItem value="responses">Codex/Responses</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={selectAccountsByCurrentFilter}
                  >
                    选中匹配账号
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedAccountIds([])}
                    disabled={selectedAccountCount === 0}
                  >
                    清空选择
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Label className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                      <Checkbox
                        checked={bulkAccountForm.setGroup}
                        disabled={bulkAccountForm.deleteSelected}
                        onCheckedChange={(checked) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            setGroup: Boolean(checked),
                          }))
                        }
                      />
                      改分组
                      <Select
                        value={bulkAccountForm.groupId}
                        disabled={!bulkAccountForm.setGroup}
                        onValueChange={(value) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            groupId: value,
                          }))
                        }
                      >
                        <SelectTrigger className="ml-auto w-36">
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
                    </Label>
                    <Label className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                      <Checkbox
                        checked={bulkAccountForm.setMode}
                        disabled={bulkAccountForm.deleteSelected}
                        onCheckedChange={(checked) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            setMode: Boolean(checked),
                          }))
                        }
                      />
                      切接口
                      <Select
                        value={bulkAccountForm.implementationMode}
                        disabled={!bulkAccountForm.setMode}
                        onValueChange={(value) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            implementationMode:
                              value as AccountBackendFormValue,
                          }))
                        }
                      >
                        <SelectTrigger className="ml-auto w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="web">Web 账号</SelectItem>
                          <SelectItem value="responses">
                            Codex/Responses
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                      <Checkbox
                        checked={bulkAccountForm.setEnabled}
                        disabled={bulkAccountForm.deleteSelected}
                        onCheckedChange={(checked) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            setEnabled: Boolean(checked),
                          }))
                        }
                      />
                      启停
                      <Select
                        value={
                          bulkAccountForm.isEnabled ? "enabled" : "disabled"
                        }
                        disabled={!bulkAccountForm.setEnabled}
                        onValueChange={(value) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            isEnabled: value === "enabled",
                          }))
                        }
                      >
                        <SelectTrigger className="ml-auto w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">启用</SelectItem>
                          <SelectItem value="disabled">停用</SelectItem>
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                      <Checkbox
                        checked={bulkAccountForm.setContentSafety}
                        disabled={bulkAccountForm.deleteSelected}
                        onCheckedChange={(checked) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            setContentSafety: Boolean(checked),
                          }))
                        }
                      />
                      内容安全
                      <Select
                        value={
                          bulkAccountForm.contentSafetyEnabled
                            ? "enabled"
                            : "disabled"
                        }
                        disabled={!bulkAccountForm.setContentSafety}
                        onValueChange={(value) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            contentSafetyEnabled: value === "enabled",
                          }))
                        }
                      >
                        <SelectTrigger className="ml-auto w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="enabled">开启</SelectItem>
                          <SelectItem value="disabled">关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label className="flex min-h-10 items-center gap-2 rounded-md border border-destructive/40 px-3 text-sm text-destructive md:col-span-2">
                      <Checkbox
                        checked={bulkAccountForm.deleteSelected}
                        onCheckedChange={(checked) =>
                          setBulkAccountForm((current) => ({
                            ...current,
                            deleteSelected: Boolean(checked),
                            setGroup: checked ? false : current.setGroup,
                            setMode: checked ? false : current.setMode,
                            setEnabled: checked ? false : current.setEnabled,
                            setContentSafety: checked
                              ? false
                              : current.setContentSafety,
                          }))
                        }
                      />
                      删除选中账号
                      <span className="text-xs text-muted-foreground">
                        只删除本站后端池记录，不删除 Sub2API 源库账号。
                      </span>
                    </Label>
                  </div>
                  <Button
                    onClick={runBulkAccountOperation}
                    disabled={
                      selectedAccountCount === 0 ||
                      !hasBulkAccountOperation ||
                      isBulkUpdatingAccounts ||
                      isBulkDeletingAccounts
                    }
                    variant={
                      bulkAccountForm.deleteSelected ? "destructive" : "default"
                    }
                  >
                    {(isBulkUpdatingAccounts || isBulkDeletingAccounts) && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    执行
                  </Button>
                </div>
                {bulkAccountForm.setMode && selectedSub2ApiAccountCount > 0 && (
                  <p className="text-xs text-destructive">
                    Sub2API 来源账号不能在本站批量切换
                    Web/Responses；手工导入账号会使用保存的 RT 重新换取目标模式
                    AT。
                  </p>
                )}
              </CardContent>
            </Card>
            {accounts.map((account) => (
              <Card key={account.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        checked={selectedAccountIdSet.has(account.id)}
                        onCheckedChange={(checked) =>
                          toggleAccountSelection(account.id, Boolean(checked))
                        }
                      />
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{account.name}</span>
                      <Badge variant="outline">
                        {account.implementationMode === "responses"
                          ? "Codex/Responses"
                          : "Web"}
                      </Badge>
                      <Badge variant="secondary">
                        {accountSourceLabel(account)}
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
                      {!account.isEnabled && (
                        <Badge variant="secondary">停用</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {account.email ||
                        getWebAccountInfo(account)?.email ||
                        "无邮箱"}{" "}
                      · {groupName(groups, account.groupId)} · 优先级{" "}
                      {account.priority} · {formatDate(account.lastUsedAt)}
                    </p>
                    {account.metadata?.sourceAccountId && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        来源账号 {account.metadata.sourceAccountId} ·{" "}
                        {account.metadata.tokenSource || "未知 token 来源"}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      成功 {account.successCount} · 失败 {account.failCount} ·
                      冷却至 {formatCooldown(account.cooldownUntil)}
                    </p>
                    {account.implementationMode === "web" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Web 套餐 {getWebAccountInfo(account)?.type || "未刷新"}{" "}
                        · 图片额度 {formatWebQuota(account)} · 恢复{" "}
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
                        {formatOptionalDate(account.lastErrorAt)} ·{" "}
                        {account.lastError}
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

        <TabsContent
          value="apis"
          className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]"
        >
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
                  setApiForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
              <Input
                placeholder="https://api.openai.com/v1"
                value={apiForm.baseUrl}
                onChange={(event) =>
                  setApiForm((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))
                }
              />
              <Input
                type="password"
                placeholder={apiForm.id ? "API Key，留空不修改" : "API Key"}
                value={apiForm.apiKey}
                onChange={(event) =>
                  setApiForm((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
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
                  setApiForm((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
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
                    setApiForm((current) => ({
                      ...current,
                      useStream: checked,
                    }))
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
                {isSavingApi && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                保存 API 后端
              </Button>
              {apiForm.id && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={resetApiForm}
                >
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
                      {!api.isEnabled && (
                        <Badge variant="secondary">停用</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {api.baseUrl} · {groupName(groups, api.groupId)} · 优先级{" "}
                      {api.priority} · {formatDate(api.lastUsedAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      成功 {api.successCount} · 失败 {api.failCount} · 冷却至{" "}
                      {formatCooldown(api.cooldownUntil)}
                    </p>
                    {api.lastError && (
                      <p className="mt-1 line-clamp-2 text-xs text-destructive">
                        {formatOptionalDate(api.lastErrorAt)} · {api.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editApi(api)}
                    >
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
                <Database className="h-4 w-4" />从 Sub2API 获取 AT
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                连接 Sub2API Postgres，只读取 OpenAI OAuth 账号。默认只同步
                Codex/Responses，并复用 Sub2API 当前 access_token；勾选 Mobile
                RT 后才会把 Sub 中 mobile client 的当前 AT 同步为
                Web/同时账号，不刷新也不回写 Sub2API 的 RT。
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
                    <SelectItem value="default">
                      全部 Sub2API OpenAI 账号
                    </SelectItem>
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
              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div>
                  <Label>Mobile RT 导入</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    仅用于 Sub 中由 Mobile RT client
                    导入的账号。关闭时强制只同步 Codex/Responses，避免误用普通
                    Codex RT。
                  </p>
                </div>
                <Switch
                  checked={importForm.allowMobileRtImport}
                  onCheckedChange={(checked) =>
                    setImportForm((current) => ({
                      ...current,
                      allowMobileRtImport: checked,
                      syncMode: checked ? current.syncMode : "responses",
                    }))
                  }
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Select
                  value={effectiveImportSyncMode}
                  onValueChange={(value) =>
                    setImportForm((current) => ({
                      ...current,
                      syncMode: value as TokenSyncMode,
                    }))
                  }
                  disabled={!importForm.allowMobileRtImport}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">
                      同时同步 Web 和 Codex AT
                    </SelectItem>
                    <SelectItem value="web">只同步 Web AT</SelectItem>
                    <SelectItem value="responses">
                      只同步 Codex/Responses AT
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
                  disabled={effectiveImportSyncMode === "responses"}
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
                  disabled={effectiveImportSyncMode === "web"}
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
                <Button onClick={runSub2ApiSync} disabled={isSyncingSub2Api}>
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

      <Dialog open={isManualImportOpen} onOpenChange={setIsManualImportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>批量导入 RT</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              支持两种方式导入 RT：一是直接粘贴 RT 列表，每行一个；二是打开{" "}
              <a
                className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                href={authSessionUrl}
                rel="noreferrer"
                target="_blank"
              >
                Auth Session 接口
                <ExternalLink className="h-3 w-3" />
              </a>{" "}
              并粘贴页面返回的整段内容，系统只会提取其中的
              refresh_token/refreshToken 作为 RT；如果只有
              accessToken，则不会导入。默认按 Codex CLI RT 导入；勾选 Mobile RT
              后由本站使用 mobile client_id 换取 AT，并保存刷新后的
              RT。这里导入的账号可在本站继续更新 RT，不会写入 Sub2API。
            </p>
            <Textarea
              className="min-h-44 font-mono text-xs"
              placeholder={`rt_...
或粘贴 https://chatgpt.com/api/auth/session 返回的完整 JSON，例如包含 "refresh_token" / "refreshToken" 的对象`}
              value={manualImportForm.refreshTokensText}
              onChange={(event) =>
                setManualImportForm((current) => ({
                  ...current,
                  refreshTokensText: event.target.value,
                }))
              }
            />
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <Label>Mobile RT 导入</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  使用 mobile client_id 获取 AT。关闭时强制只导入
                  Codex/Responses，避免普通 Codex RT 被误用于 Web。
                </p>
              </div>
              <Switch
                checked={manualImportForm.useMobileRt}
                onCheckedChange={(checked) =>
                  setManualImportForm((current) => ({
                    ...current,
                    useMobileRt: checked,
                    syncMode: checked ? current.syncMode : "responses",
                  }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={effectiveManualImportSyncMode}
                onValueChange={(value) =>
                  setManualImportForm((current) => ({
                    ...current,
                    syncMode: value as TokenSyncMode,
                  }))
                }
                disabled={!manualImportForm.useMobileRt}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="responses">
                    只导入 Codex/Responses
                  </SelectItem>
                  <SelectItem value="web">只导入 Web</SelectItem>
                  <SelectItem value="both">同时导入 Web 和 Codex</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="名称前缀"
                value={manualImportForm.namePrefix}
                onChange={(event) =>
                  setManualImportForm((current) => ({
                    ...current,
                    namePrefix: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={manualImportForm.webGroupId}
                onValueChange={(value) =>
                  setManualImportForm((current) => ({
                    ...current,
                    webGroupId: value,
                  }))
                }
                disabled={effectiveManualImportSyncMode === "responses"}
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
                value={manualImportForm.responsesGroupId}
                onValueChange={(value) =>
                  setManualImportForm((current) => ({
                    ...current,
                    responsesGroupId: value,
                  }))
                }
                disabled={effectiveManualImportSyncMode === "web"}
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
            <div className="grid gap-3 md:grid-cols-3">
              <Input
                placeholder="模型，可选"
                value={manualImportForm.model}
                onChange={(event) =>
                  setManualImportForm((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
              />
              <Input
                type="number"
                value={manualImportForm.priority}
                onChange={(event) =>
                  setManualImportForm((current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
              />
              <Input
                type="number"
                value={manualImportForm.concurrency}
                onChange={(event) =>
                  setManualImportForm((current) => ({
                    ...current,
                    concurrency: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>接入内容安全审核</Label>
              <Switch
                checked={manualImportForm.contentSafetyEnabled}
                onCheckedChange={(checked) =>
                  setManualImportForm((current) => ({
                    ...current,
                    contentSafetyEnabled: checked,
                  }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsManualImportOpen(false)}
                disabled={isImportingManualRefreshTokens}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() =>
                  importManualRefreshTokens({
                    ...manualImportForm,
                    syncMode: effectiveManualImportSyncMode,
                  })
                }
                disabled={
                  isImportingManualRefreshTokens ||
                  !manualImportForm.refreshTokensText.trim()
                }
              >
                {isImportingManualRefreshTokens && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                导入并获取 AT
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
