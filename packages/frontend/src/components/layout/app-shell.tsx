import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { NavDrawer } from "./nav-drawer";
import { CommandPalette } from "@/components/command-palette";
import { CrumbLabelProvider } from "./crumb-context";
import { Sheet } from "@/components/ui/sheet";
import { useSidebarShortcut } from "@/lib/use-sidebar-shortcut";

/**
 * Authenticated layout shell per docs/ux.md §3: persistent left sidebar +
 * slim top bar wrapping all authenticated pages via <Outlet/>.
 * Below `md` the sidebar is replaced by an off-canvas NavDrawer (ADR-108);
 * the Sheet root wraps the whole shell so the TopBar hamburger is the
 * Radix trigger (focus trap + focus return come from the primitive).
 * `Ctrl+B` toggles whichever chrome is active (use-sidebar-shortcut).
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleDrawer = useCallback(() => setDrawerOpen((o) => !o), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useSidebarShortcut({ onToggleDrawer: toggleDrawer });

  // Crossing to >=md while the drawer is open must dismiss it — CSS alone
  // hides the content but leaves stale open state (FR-009).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mq.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
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
        <NavDrawer onNavigate={closeDrawer} />
        <CommandPalette />
      </div>
    </Sheet>
  );
}
