"use client";

import { Ban, Coins, Loader2, Search, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { formatCredits } from "@repo/shared/credits/format";
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import {
  adminGrantCreditsAction,
  banUserAction,
  getAllUsersAction,
} from "@repo/shared/support/actions";
import { UserRoleSelect } from "@repo/shared/support/components";

/**
 * 用户类型定义
 *
 * 匹配 getAllUsersAction 返回的扁平化字段
 */
interface UserWithDetails {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "user" | "admin";
  banned: boolean;
  bannedReason: string | null;
  emailVerified: boolean;
  createdAt: Date;
  creditsBalance: number;
  subscriptionStatus: string | null;
  subscriptionPriceId: string | null;
}

/**
 * 管理员 - 用户管理页面 (客户端组件)
 *
 * 功能:
 * - 搜索用户 (邮箱/名称)
 * - 查看积分余额
 * - 查看订阅状态
 * - 修改用户角色
 * - 封禁/解封用户
 * - 手动充值积分
 */
export default function AdminUsersPage() {
  const t = useTranslations("Admin");
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // 封禁对话框状态
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserWithDetails | null>(
    null
  );
  const [banReason, setBanReason] = useState("");
  const [isBanning, setIsBanning] = useState(false);

  // 充值对话框状态
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [isGranting, setIsGranting] = useState(false);

  /**
   * 加载用户列表
   */
  const loadUsers = async (query?: string) => {
    setIsLoading(true);
    try {
      const result = await getAllUsersAction(query ? { query } : undefined);
      if (result?.data?.users) {
        setUsers(result.data.users as UserWithDetails[]);
      }
    } catch (error) {
      toast.error(t("users.errors.loadFailed"));
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    loadUsers();
  }, []);

  /**
   * 处理搜索
   */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
    loadUsers(searchInput);
  };

  /**
   * 打开封禁对话框
   */
  const openBanDialog = (user: UserWithDetails) => {
    setSelectedUser(user);
    setBanReason("");
    setBanDialogOpen(true);
  };

  /**
   * 处理封禁/解封
   */
  const handleBan = async () => {
    if (!selectedUser) return;

    setIsBanning(true);
    try {
      const result = await banUserAction({
        userId: selectedUser.id,
        banned: !selectedUser.banned,
        reason: banReason || undefined,
      });

      if (result?.data) {
        toast.success(result.data.message);
        setBanDialogOpen(false);
        loadUsers(searchQuery);
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(t("users.errors.operationFailed"));
      console.error(error);
    } finally {
      setIsBanning(false);
    }
  };

  /**
   * 打开充值对话框
   */
  const openGrantDialog = (user: UserWithDetails) => {
    setSelectedUser(user);
    setGrantAmount("");
    setGrantReason("");
    setGrantDialogOpen(true);
  };

  /**
   * 处理充值
   */
  const handleGrant = async () => {
    if (!selectedUser) return;

    const amount = Number.parseFloat(grantAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error(t("users.errors.invalidAmount"));
      return;
    }

    if (!grantReason.trim()) {
      toast.error(t("users.errors.reasonRequired"));
      return;
    }

    setIsGranting(true);
    try {
      const result = await adminGrantCreditsAction({
        userId: selectedUser.id,
        amount,
        reason: grantReason.trim(),
      });

      if (result?.data) {
        toast.success(result.data.message);
        setGrantDialogOpen(false);
        loadUsers(searchQuery);
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(t("users.errors.grantFailed"));
      console.error(error);
    } finally {
      setIsGranting(false);
    }
  };

  /**
   * 获取用户名首字母
   */
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  /**
   * 获取订阅状态显示
   */
  const getSubscriptionBadge = (status: string | null) => {
    if (!status) {
      return (
        <Badge variant="secondary" className="bg-muted text-muted-foreground">
          {t("users.subscriptionLabels.none")}
        </Badge>
      );
    }

    const statusMap: Record<string, { labelKey: string; color: string }> = {
      active: {
        labelKey: "users.subscriptionLabels.active",
        color: "bg-foreground text-background",
      },
      canceled: {
        labelKey: "users.subscriptionLabels.canceled",
        color: "bg-foreground/10 text-foreground",
      },
      past_due: {
        labelKey: "users.subscriptionLabels.pastDue",
        color: "bg-foreground/10 text-foreground",
      },
      incomplete: {
        labelKey: "users.subscriptionLabels.incomplete",
        color: "bg-muted text-muted-foreground",
      },
    };

    // 获取配置，使用默认值避免 undefined
    const defaultConfig = {
      labelKey: "users.subscriptionLabels.incomplete",
      color: "bg-muted text-muted-foreground",
    };
    const config = statusMap[status] ?? defaultConfig;
    return (
      <Badge variant="secondary" className={config.color}>
        {t(config.labelKey)}
      </Badge>
    );
  };

  // 统计数据
  const totalUsers = users.length;
  const adminCount = users.filter((u) => u.role === "admin").length;
  const bannedCount = users.filter((u) => u.banned).length;
  const activeSubscriptions = users.filter(
    (u) => u.subscriptionStatus === "active"
  ).length;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-2xl font-bold font-serif tracking-tight">
          {t("users.title")}
        </h2>
        <p className="text-muted-foreground">{t("users.subtitle")}</p>
      </div>

      {/* 统计信息 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("users.stats.totalUsers")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUsers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("users.stats.admins")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{adminCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("users.stats.subscribers")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSubscriptions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("users.stats.banned")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{bannedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* 搜索栏 */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("users.search.placeholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("users.search.button")}
            </Button>
            {searchQuery && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearchInput("");
                  setSearchQuery("");
                  loadUsers();
                }}
              >
                {t("users.search.clear")}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {/* 用户列表 */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("users.table.title")}
            {searchQuery && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {t("users.search.searchLabel", { query: searchQuery })}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery
                ? t("users.table.noResults")
                : t("users.table.noUsers")}
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3">{t("users.table.user")}</th>
                    <th className="px-4 py-3">{t("users.table.status")}</th>
                    <th className="px-4 py-3">{t("users.table.credits")}</th>
                    <th className="px-4 py-3">
                      {t("users.table.subscription")}
                    </th>
                    <th className="px-4 py-3">{t("users.table.role")}</th>
                    <th className="px-4 py-3">{t("users.table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage
                              src={u.image || undefined}
                              alt={u.name}
                            />
                            <AvatarFallback className="bg-foreground text-background text-xs">
                              {getInitials(u.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <span className="font-medium">{u.name}</span>
                            <p className="text-xs text-muted-foreground">
                              {u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {u.banned ? (
                            <Badge
                              variant="secondary"
                              className="bg-destructive/10 text-destructive"
                            >
                              {t("users.statusLabels.banned")}
                            </Badge>
                          ) : u.emailVerified ? (
                            <Badge
                              variant="secondary"
                              className="bg-foreground/10 text-foreground"
                            >
                              {t("users.statusLabels.verified")}
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="bg-muted text-muted-foreground"
                            >
                              {t("users.statusLabels.unverified")}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Coins className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">
                            {formatCredits(u.creditsBalance ?? 0)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {getSubscriptionBadge(u.subscriptionStatus)}
                      </td>
                      <td className="px-4 py-3">
                        <UserRoleSelect userId={u.id} currentRole={u.role} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openGrantDialog(u)}
                            title={t("users.tooltips.grantCredits")}
                          >
                            <Coins className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openBanDialog(u)}
                            title={
                              u.banned
                                ? t("users.tooltips.unban")
                                : t("users.tooltips.ban")
                            }
                          >
                            {u.banned ? (
                              <UserCheck className="h-4 w-4" />
                            ) : (
                              <Ban className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 封禁对话框 */}
      <Dialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedUser?.banned
                ? t("users.ban.unbanTitle")
                : t("users.ban.banTitle")}
            </DialogTitle>
            <DialogDescription>
              {selectedUser?.banned
                ? t("users.ban.unbanDescription", {
                    name: selectedUser?.name ?? "",
                  })
                : t("users.ban.banDescription", {
                    name: selectedUser?.name ?? "",
                  })}
            </DialogDescription>
          </DialogHeader>
          {!selectedUser?.banned && (
            <div className="space-y-2">
              <Label htmlFor="banReason">{t("users.ban.reasonLabel")}</Label>
              <Textarea
                id="banReason"
                placeholder={t("users.ban.reasonPlaceholder")}
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBanDialogOpen(false)}
              disabled={isBanning}
            >
              {t("users.ban.cancel")}
            </Button>
            <Button
              className={
                selectedUser?.banned
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : ""
              }
              variant={selectedUser?.banned ? "default" : "outline"}
              onClick={handleBan}
              disabled={isBanning}
            >
              {isBanning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {selectedUser?.banned
                ? t("users.ban.confirmUnban")
                : t("users.ban.confirmBan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 充值对话框 */}
      <Dialog open={grantDialogOpen} onOpenChange={setGrantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("users.grant.title")}</DialogTitle>
            <DialogDescription>
              {t("users.grant.description", { name: selectedUser?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="grantAmount">
                {t("users.grant.amountLabel")}
              </Label>
              <Input
                id="grantAmount"
                type="number"
                placeholder={t("users.grant.amountPlaceholder")}
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                min={0.01}
                step={0.01}
                max={100000}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grantReason">
                {t("users.grant.reasonLabel")}
              </Label>
              <Textarea
                id="grantReason"
                placeholder={t("users.grant.reasonPlaceholder")}
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGrantDialogOpen(false)}
              disabled={isGranting}
            >
              {t("users.grant.cancel")}
            </Button>
            <Button
              onClick={handleGrant}
              disabled={isGranting}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {isGranting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("users.grant.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
