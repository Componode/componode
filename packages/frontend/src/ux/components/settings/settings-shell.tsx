import { Outlet } from "react-router-dom";
import { SettingsNav } from "@/ux/components/settings/settings-nav";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";

/** Layout route for /ux/settings/* — shared header + secondary nav. */
export function SettingsShell() {
  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Personal preferences apply only to you. Workspace settings affect everyone."
      />
      <div className="flex flex-col gap-8 lg:flex-row">
        <SettingsNav />
        <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-6">
          <Outlet />
        </div>
      </div>
    </PageContainer>
  );
}
