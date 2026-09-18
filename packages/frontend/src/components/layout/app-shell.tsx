import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { CommandPalette } from "@/components/command-palette";
import { CrumbLabelProvider } from "./crumb-context";

/**
 * Authenticated layout shell per docs/ux.md §3: persistent left sidebar +
 * slim top bar wrapping all authenticated pages via <Outlet/>.
 */
export function AppShell() {
  return (
    <div className="flex h-dvh overflow-hidden bg-background" data-testid="app-shell">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <CrumbLabelProvider>
          <TopBar />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </CrumbLabelProvider>
      </div>
      <CommandPalette />
    </div>
  );
}
