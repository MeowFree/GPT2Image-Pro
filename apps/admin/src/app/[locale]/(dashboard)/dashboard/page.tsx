import { count, eq, gte, sum } from "drizzle-orm";
import {
  Coins,
  CreditCard,
  Image as ImageIcon,
  MessageSquare,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/routing";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { db } from "@repo/database";
import {
  creditsBalance,
  generation,
  subscription,
  ticket,
  user,
} from "@repo/database/schema";
import { formatCredits } from "@repo/shared/credits/format";

/**
 * Admin 控制面板页面
 *
 * 展示关键统计数据:
 * - 用户统计
 * - 工单统计
 * - 积分统计
 * - 订阅统计
 */
export default async function AdminDashboardPage() {
  const t = await getTranslations("Admin");

  // 获取今天的开始时间
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 获取本周的开始时间
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  // 获取本月的开始时间
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // 并行获取所有统计数据
  const [
    // 用户统计
    totalUsersResult,
    adminUsersResult,
    bannedUsersResult,
    newUsersThisWeekResult,
    // 工单统计
    openTicketsResult,
    inProgressTicketsResult,
    totalTicketsResult,
    newTicketsTodayResult,
    // 积分统计
    totalCreditsResult,
    totalCreditsEarnedResult,
    totalCreditsSpentResult,
    // 订阅统计
    activeSubscriptionsResult,
    totalSubscriptionsResult,
    // 生成统计
    totalGenerationsResult,
    todayGenerationsResult,
    completedGenerationsResult,
    totalGenerationCreditsResult,
  ] = await Promise.all([
    // 用户统计
    db.select({ count: count() }).from(user),
    db.select({ count: count() }).from(user).where(eq(user.role, "admin")),
    db.select({ count: count() }).from(user).where(eq(user.banned, true)),
    db
      .select({ count: count() })
      .from(user)
      .where(gte(user.createdAt, weekStart)),

    // 工单统计
    db
      .select({ count: count() })
      .from(ticket)
      .where(eq(ticket.status, "open")),
    db
      .select({ count: count() })
      .from(ticket)
      .where(eq(ticket.status, "in_progress")),
    db.select({ count: count() }).from(ticket),
    db
      .select({ count: count() })
      .from(ticket)
      .where(gte(ticket.createdAt, todayStart)),

    // 积分统计
    db.select({ total: sum(creditsBalance.balance) }).from(creditsBalance),
    db.select({ total: sum(creditsBalance.totalEarned) }).from(creditsBalance),
    db.select({ total: sum(creditsBalance.totalSpent) }).from(creditsBalance),

    // 订阅统计
    db
      .select({ count: count() })
      .from(subscription)
      .where(eq(subscription.status, "active")),
    db.select({ count: count() }).from(subscription),

    // 生成统计
    db.select({ count: count() }).from(generation),
    db
      .select({ count: count() })
      .from(generation)
      .where(gte(generation.createdAt, todayStart)),
    db
      .select({ count: count() })
      .from(generation)
      .where(eq(generation.status, "completed")),
    db.select({ total: sum(generation.creditsConsumed) }).from(generation),
  ]);

  // 解析统计结果
  const stats = {
    users: {
      total: totalUsersResult[0]?.count ?? 0,
      admins: adminUsersResult[0]?.count ?? 0,
      banned: bannedUsersResult[0]?.count ?? 0,
      newThisWeek: newUsersThisWeekResult[0]?.count ?? 0,
    },
    tickets: {
      open: openTicketsResult[0]?.count ?? 0,
      inProgress: inProgressTicketsResult[0]?.count ?? 0,
      total: totalTicketsResult[0]?.count ?? 0,
      newToday: newTicketsTodayResult[0]?.count ?? 0,
    },
    credits: {
      totalBalance: Number(totalCreditsResult[0]?.total ?? 0),
      totalEarned: Number(totalCreditsEarnedResult[0]?.total ?? 0),
      totalSpent: Number(totalCreditsSpentResult[0]?.total ?? 0),
    },
    subscriptions: {
      active: activeSubscriptionsResult[0]?.count ?? 0,
      total: totalSubscriptionsResult[0]?.count ?? 0,
    },
  };

  const generationStats = {
    total: totalGenerationsResult[0]?.count ?? 0,
    today: todayGenerationsResult[0]?.count ?? 0,
    completed: completedGenerationsResult[0]?.count ?? 0,
    creditsConsumed: Number(totalGenerationCreditsResult[0]?.total ?? 0),
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-2xl font-bold font-serif tracking-tight">
          {t("dashboard.title")}
        </h2>
        <p className="text-muted-foreground">{t("dashboard.subtitle")}</p>
      </div>

      {/* 主要统计卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {/* 总用户数 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("dashboard.stats.totalUsers")}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.users.total}</div>
            <p className="text-xs text-muted-foreground">
              {t("dashboard.stats.newUsersThisWeek", {
                count: stats.users.newThisWeek,
              })}
            </p>
          </CardContent>
        </Card>

        {/* 待处理工单 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("dashboard.stats.pendingTickets")}
            </CardTitle>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.tickets.open + stats.tickets.inProgress}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("dashboard.stats.newTicketsToday", {
                count: stats.tickets.newToday,
              })}
            </p>
          </CardContent>
        </Card>

        {/* 活跃订阅 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("dashboard.stats.activeSubscriptions")}
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.subscriptions.active}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("dashboard.stats.totalSubscriptions", {
                count: stats.subscriptions.total,
              })}
            </p>
          </CardContent>
        </Card>

        {/* 积分流通量 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("dashboard.stats.creditsCirculation")}
            </CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCredits(stats.credits.totalBalance)}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("dashboard.stats.currentUserCredits")}
            </p>
          </CardContent>
        </Card>

        {/* 图片生成 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("dashboard.stats.imageGeneration")}
            </CardTitle>
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{generationStats.total}</div>
            <p className="text-xs text-muted-foreground">
              {t("dashboard.stats.generationToday", {
                today: generationStats.today,
                completed: generationStats.completed,
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 详细统计 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* 用户详情 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("dashboard.details.userStats")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.totalUsersLabel")}
              </span>
              <span className="font-medium">{stats.users.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.admins")}
              </span>
              <span className="font-medium">{stats.users.admins}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.regularUsers")}
              </span>
              <span className="font-medium">
                {stats.users.total - stats.users.admins}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.banned")}
              </span>
              <span className="font-medium">{stats.users.banned}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">
                {t("dashboard.details.newThisWeek")}
              </span>
              <span className="font-medium">+{stats.users.newThisWeek}</span>
            </div>
          </CardContent>
        </Card>

        {/* 工单详情 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {t("dashboard.details.ticketStats")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.pending")}
              </span>
              <span className="font-medium">{stats.tickets.open}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.inProgress")}
              </span>
              <span className="font-medium">{stats.tickets.inProgress}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.totalTickets")}
              </span>
              <span className="font-medium">{stats.tickets.total}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">
                {t("dashboard.details.newToday")}
              </span>
              <span className="font-medium">+{stats.tickets.newToday}</span>
            </div>
          </CardContent>
        </Card>

        {/* 积分详情 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {t("dashboard.details.creditsFlow")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.currentBalance")}
              </span>
              <span className="font-medium">
                {formatCredits(stats.credits.totalBalance)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.totalGranted")}
              </span>
              <span className="font-medium">
                +{formatCredits(stats.credits.totalEarned)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.totalSpent")}
              </span>
              <span className="font-medium">
                -{formatCredits(stats.credits.totalSpent)}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">
                {t("dashboard.details.subscriberCount")}
              </span>
              <span className="font-medium">
                {t("dashboard.details.activeLabel", {
                  count: stats.subscriptions.active,
                })}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 生成统计 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              {t("dashboard.details.generationStats")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.totalGenerations")}
              </span>
              <span className="font-medium">{generationStats.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.successRate")}
              </span>
              <span className="font-medium">
                {generationStats.total > 0
                  ? Math.round(
                      (generationStats.completed / generationStats.total) * 100
                    )
                  : 0}
                %
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.details.creditsConsumed")}
              </span>
              <span className="font-medium">
                {formatCredits(generationStats.creditsConsumed)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 快速操作 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.quickActions.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              href="/dashboard/users"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-muted transition-colors"
            >
              <Users className="h-4 w-4" />
              <span>{t("dashboard.quickActions.manageUsers")}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {t("dashboard.quickActions.usersCount", {
                  count: stats.users.total,
                })}
              </span>
            </Link>
            <Link
              href="/dashboard/tickets"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-muted transition-colors"
            >
              <Ticket className="h-4 w-4" />
              <span>{t("dashboard.quickActions.handleTickets")}</span>
              {stats.tickets.open > 0 && (
                <span className="ml-auto rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground">
                  {t("dashboard.quickActions.pendingCount", {
                    count: stats.tickets.open,
                  })}
                </span>
              )}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.systemInfo.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.systemInfo.version")}
              </span>
              <span>1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.systemInfo.environment")}
              </span>
              <span>{process.env.NODE_ENV}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("dashboard.systemInfo.database")}
              </span>
              <span>PostgreSQL</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
