import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getUserRoleById } from "@repo/shared/auth/role-server";
import {
  canAccessAdminArea,
  canManageUserPermissions,
} from "@repo/shared/auth/roles";
import { getServerSession } from "@repo/shared/auth/server";
import { AdminUsersManagement } from "@repo/shared/support/components";
import { getAppTimeZone } from "@repo/shared/time-zone/server";

export default async function DashboardAdminUsersPage() {
  const session = await getServerSession();
  const locale = await getLocale();
  if (!session?.user) {
    redirect(`/${locale}/sign-in`);
  }

  const role = await getUserRoleById(session.user.id);
  if (!canAccessAdminArea(role)) {
    redirect(`/${locale}/dashboard`);
  }

  const timeZone = await getAppTimeZone();

  return (
    <AdminUsersManagement
      canManageRoles={canManageUserPermissions(role)}
      timeZone={timeZone}
    />
  );
}
