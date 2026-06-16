import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getUserRoleById } from "@repo/shared/auth/role-server";
import {
  canAccessAdminArea,
  canManageUserPermissions,
  canViewImageBackendPool,
} from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { getAppTimeZone } from "@repo/shared/time-zone/server";
import { ImageBackendPoolAdminPanel } from "@/features/image-backend-pool";
import { AdminSettingsTabs } from "./admin-settings-tabs";

export default async function DashboardAdminSettingsPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const role = await getUserRoleById(session.user.id);
  if (!canViewImageBackendPool(role)) {
    redirect(`/${locale}/dashboard`);
  }

  if (!canAccessAdminArea(role)) {
    const timeZone = await getAppTimeZone();
    return <ImageBackendPoolAdminPanel readOnly timeZone={timeZone} />;
  }
  const timeZone = await getAppTimeZone();

  // 系统设置面板可写入 BETTER_AUTH_SECRET 等密钥，必须限制为超管，
  // 否则普通 admin 可改写认证密钥伪造会话实现账号接管（见审计 S-C1）。
  return (
    <AdminSettingsTabs
      timeZone={timeZone}
      canManageSystemSettings={canManageUserPermissions(role)}
    />
  );
}
