import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppHeader, LeafCrumbProvider } from "@/ux/components/app/app-header";
import { AppSidebar } from "@/ux/components/app/app-sidebar";
import { CommandMenuProvider } from "@/ux/components/app/command-menu";
import { SessionProvider } from "@/ux/components/app/session-context";
import { SidebarInset, SidebarProvider } from "@/ux/components/ui/sidebar";

const SIDEBAR_KEY = "ux_sidebar_state";

// Application shell for the v1.1.0 UX baseline (spec 029): the ported
// prototype app shell mounted at / inside the app-level .ux-root token scope.
export function UxShell() {
  // Controlled: passing onOpenChange alone would suppress the provider's
  // internal state (stock shadcn sidebar semantics).
  const [sidebarOpen, setSidebarOpen] = useState(
    () => sessionStorage.getItem(SIDEBAR_KEY) !== "false",
  );
  return (
    <>
      <SessionProvider>
        <CommandMenuProvider>
          <SidebarProvider
            open={sidebarOpen}
            onOpenChange={(open) => {
              setSidebarOpen(open);
              sessionStorage.setItem(SIDEBAR_KEY, String(open));
            }}
          >
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <LeafCrumbProvider>
                <AppHeader />
                <main id="main" className="min-w-0 flex-1">
                  <Outlet />
                </main>
              </LeafCrumbProvider>
            </SidebarInset>
          </SidebarProvider>
        </CommandMenuProvider>
      </SessionProvider>
    </>
  );
}
