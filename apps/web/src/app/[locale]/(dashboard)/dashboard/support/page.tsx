import { desc, eq } from "drizzle-orm";
import { Plus, Ticket } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { db } from "@repo/database";
import { ticket } from "@repo/database/schema";
import { getServerSession } from "@repo/shared/auth/server";

/**
 * 用户工单列表页面
 *
 * 展示用户提交的所有支持工单
 */
export default async function SupportPage() {
  // 获取当前用户会话
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in");
  }

  const t = await getTranslations("Support");
  const locale = await getLocale();

  // 获取用户的工单列表
  const tickets = await db
    .select()
    .from(ticket)
    .where(eq(ticket.userId, session.user.id))
    .orderBy(desc(ticket.createdAt));

  /**
   * 获取状态徽章样式
   */
  const getStatusBadge = (status: string) => {
    const colorMap: Record<string, string> = {
      open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      in_progress:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      resolved:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      closed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
    };
    return (
      <Badge
        className={colorMap[status] || colorMap.closed}
        variant="secondary"
      >
        {t(`statuses.${status}` as Parameters<typeof t>[0])}
      </Badge>
    );
  };

  /**
   * 获取优先级徽章样式
   */
  const getPriorityBadge = (priority: string) => {
    const colorMap: Record<string, string> = {
      low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      medium:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    };
    return (
      <Badge
        className={colorMap[priority] || colorMap.medium}
        variant="secondary"
      >
        {t(`priorities.${priority}` as Parameters<typeof t>[0])}
      </Badge>
    );
  };

  /**
   * 获取类别标签
   */
  const getCategoryLabel = (category: string) => {
    return t(`categories.${category}` as Parameters<typeof t>[0]);
  };

  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/dashboard/support/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t("newTicket")}
          </Button>
        </Link>
      </div>

      {/* 工单列表 */}
      {tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">{t("noTickets")}</h3>
            <p className="text-muted-foreground mb-4">
              {t("noTicketsDescription")}
            </p>
            <Link href="/dashboard/support/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t("createFirst")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tickets.map((tkt) => (
            <Link key={tkt.id} href={`/dashboard/support/${tkt.id}`}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{tkt.subject}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {getCategoryLabel(tkt.category)} ·{" "}
                        {new Date(tkt.createdAt).toLocaleDateString(dateLocale)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getPriorityBadge(tkt.priority)}
                      {getStatusBadge(tkt.status)}
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
