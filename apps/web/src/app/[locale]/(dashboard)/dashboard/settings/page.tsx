import { redirect } from "next/navigation";
import { SettingsProfileView } from "@/features/settings/components";
import { getServerSession } from "@repo/shared/auth/server";

/**
 * 设置页面元数据
 */
export const metadata = {
  title: "Settings | GPT2IMAGE",
  description: "Manage your account settings and preferences",
};

/**
 * 用户设置页面
 *
 * Server Component - 在服务端获取用户数据
 * 将数据传递给客户端 SettingsProfileView 组件
 */
export default async function SettingsPage() {
  // 获取当前用户会话
  const session = await getServerSession();

  // 如果用户未登录，重定向到登录页
  if (!session || !session.user) {
    redirect("/sign-in");
  }

  return (
    <SettingsProfileView
      user={{
        id: session.user.id,
        name: session.user.name || "",
        email: session.user.email || "",
        image: session.user.image,
      }}
    />
  );
}
