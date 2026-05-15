import {
  DashboardMainWrapper,
  DashboardSidebar,
} from "@/features/dashboard/components";
import { SidebarProvider } from "@/features/dashboard/context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="min-h-screen bg-muted">
        <DashboardSidebar />
        <DashboardMainWrapper>{children}</DashboardMainWrapper>
      </div>
    </SidebarProvider>
  );
}
