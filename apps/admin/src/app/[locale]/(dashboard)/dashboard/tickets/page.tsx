import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar";
import { Badge } from "@repo/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { db } from "@repo/database";
import { ticket, user } from "@repo/database/schema";
import {
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
} from "@repo/shared/support/schemas";
import { Link } from "@/i18n/routing";

/**
 * 管理员 - 工单管理列表页面
 *
 * 展示所有用户提交的工单
 */
export default async function AdminTicketsPage() {
  const t = await getTranslations("Admin");

  // 获取所有工单（包含用户信息）
  const tickets = await db
    .select({
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(ticket)
    .leftJoin(user, eq(ticket.userId, user.id))
    .orderBy(desc(ticket.createdAt));

  /**
   * 获取状态徽章样式
   */
  const getStatusBadge = (status: string) => {
    const statusConfig = ticketStatuses.find((s) => s.value === status);
    const colorMap: Record<string, string> = {
      open: "bg-foreground text-background",
      in_progress: "bg-foreground/80 text-background",
      resolved: "bg-foreground/10 text-foreground",
      closed: "bg-muted text-muted-foreground",
    };
    return (
      <Badge
        className={colorMap[status] || colorMap.closed}
        variant="secondary"
      >
        {statusConfig?.label || status}
      </Badge>
    );
  };

  /**
   * 获取优先级徽章样式
   */
  const getPriorityBadge = (priority: string) => {
    const priorityConfig = ticketPriorities.find((p) => p.value === priority);
    const colorMap: Record<string, string> = {
      low: "bg-muted text-muted-foreground",
      medium: "bg-foreground/10 text-foreground",
      high: "bg-foreground text-background",
    };
    return (
      <Badge
        className={colorMap[priority] || colorMap.medium}
        variant="secondary"
      >
        {priorityConfig?.label || priority}
      </Badge>
    );
  };

  /**
   * 获取类别标签
   */
  const getCategoryLabel = (category: string) => {
    const categoryConfig = ticketCategories.find((c) => c.value === category);
    return categoryConfig?.label || category;
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

  // 统计数据
  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter(
    (t) => t.status === "in_progress"
  ).length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-2xl font-bold font-serif tracking-tight">
          {t("tickets.title")}
        </h2>
        <p className="text-muted-foreground">{t("tickets.subtitle")}</p>
      </div>

      {/* 统计信息 */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tickets.stats.pending")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{openCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tickets.stats.inProgress")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgressCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tickets.stats.resolved")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{resolvedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t("tickets.stats.total")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* 工单列表 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("tickets.table.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("tickets.table.noTickets")}
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3">{t("tickets.table.subject")}</th>
                    <th className="px-4 py-3">{t("tickets.table.user")}</th>
                    <th className="px-4 py-3">{t("tickets.table.category")}</th>
                    <th className="px-4 py-3">{t("tickets.table.priority")}</th>
                    <th className="px-4 py-3">{t("tickets.table.status")}</th>
                    <th className="px-4 py-3">
                      {t("tickets.table.createdAt")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t_ticket) => (
                    <tr
                      key={t_ticket.id}
                      className="border-b hover:bg-muted/50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/tickets/${t_ticket.id}`}
                          className="font-medium hover:underline"
                        >
                          {t_ticket.subject}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage
                              src={t_ticket.user?.image || undefined}
                              alt={
                                t_ticket.user?.name ||
                                t("tickets.table.userFallback")
                              }
                            />
                            <AvatarFallback className="bg-foreground text-background text-xs">
                              {t_ticket.user?.name
                                ? getInitials(t_ticket.user.name)
                                : "U"}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-sm">
                              {t_ticket.user?.name ||
                                t("tickets.table.unknownUser")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t_ticket.user?.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {getCategoryLabel(t_ticket.category)}
                      </td>
                      <td className="px-4 py-3">
                        {getPriorityBadge(t_ticket.priority)}
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(t_ticket.status)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(t_ticket.createdAt).toLocaleDateString(
                          "zh-CN"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
