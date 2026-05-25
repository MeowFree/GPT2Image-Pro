import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { CheckCircle2, Megaphone, Pin } from "lucide-react";

import {
  listActiveAnnouncementsForUser,
  markAnnouncementIdsReadForUser,
} from "@repo/shared/announcements";
import { getServerSession } from "@repo/shared/auth/server";
import { formatDateInTimeZone } from "@repo/shared/time-zone";
import { getAppTimeZone } from "@repo/shared/time-zone/server";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { cn } from "@repo/ui/utils";

function getSeverityMeta(severity: string) {
  switch (severity) {
    case "success":
      return {
        label: "更新",
        className:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
        borderClassName: "border-l-emerald-500",
      };
    case "warning":
      return {
        label: "重要",
        className:
          "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
        borderClassName: "border-l-amber-500",
      };
    case "critical":
      return {
        label: "紧急",
        className:
          "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
        borderClassName: "border-l-red-500",
      };
    case "info":
    default:
      return {
        label: "公告",
        className:
          "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
        borderClassName: "border-l-sky-500",
      };
  }
}

function formatDateTime(
  value: Date | string | null | undefined,
  locale: string,
  timeZone: string
) {
  return formatDateInTimeZone(
    value,
    locale,
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    },
    timeZone
  );
}

export default async function DashboardAnnouncementsPage() {
  const [session, locale, timeZone] = await Promise.all([
    getServerSession(),
    getLocale(),
    getAppTimeZone(),
  ]);

  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const announcements = await listActiveAnnouncementsForUser(session.user.id);
  const unreadIds = announcements
    .filter((item) => !item.readAt)
    .map((item) => item.id);

  if (unreadIds.length > 0) {
    await markAnnouncementIdsReadForUser(session.user.id, unreadIds);
  }

  const isZh = locale === "zh";
  const copy = (en: string, zh: string) => (isZh ? zh : en);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {copy("Announcements", "公告")}
        </h2>
        <p className="text-muted-foreground">
          {copy(
            "System updates, maintenance notices, and platform messages.",
            "系统更新、维护通知和平台消息会集中展示在这里。"
          )}
        </p>
      </div>

      {announcements.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Megaphone className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">
                {copy("No active announcements", "暂无生效公告")}
              </p>
              <p className="text-sm text-muted-foreground">
                {copy(
                  "New notices will appear here when published.",
                  "有新公告发布后会显示在这里。"
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {announcements.map((item) => {
            const meta = getSeverityMeta(item.severity);
            const wasUnread = unreadIds.includes(item.id);

            return (
              <Card
                key={item.id}
                className={cn(
                  "border-l-4",
                  meta.borderClassName,
                  wasUnread && "bg-muted/30"
                )}
              >
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={meta.className}>{meta.label}</Badge>
                    {item.isPinned && (
                      <Badge variant="outline">
                        <Pin className="mr-1 h-3 w-3" />
                        {copy("Pinned", "置顶")}
                      </Badge>
                    )}
                    {wasUnread ? (
                      <Badge variant="default">{copy("New", "未读")}</Badge>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {copy("Read", "已读")}
                      </span>
                    )}
                  </div>
                  <div>
                    <CardTitle className="text-xl">{item.title}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {copy("Published", "发布于")}{" "}
                      {formatDateTime(
                        item.publishedAt ?? item.createdAt,
                        locale,
                        timeZone
                      )}
                      {item.expiresAt
                        ? ` · ${copy("Expires", "过期于")} ${formatDateTime(
                            item.expiresAt,
                            locale,
                            timeZone
                          )}`
                        : ""}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="whitespace-pre-wrap break-words text-sm leading-7">
                    {item.content}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
