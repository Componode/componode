import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppHeader } from "@/ux/components/app/app-header";
import { AppSidebar } from "@/ux/components/app/app-sidebar";
import { CommandMenuProvider } from "@/ux/components/app/command-menu";
import { SessionProvider } from "@/ux/components/app/session-context";
import { UxPrefsSync } from "@/ux/lib/prefs";
import { SidebarInset, SidebarProvider } from "@/ux/components/ui/sidebar";
import "./styles.css";

const SIDEBAR_KEY = "ux_sidebar_state";

// Application shell for the v1.1.0 UX baseline (spec 029): the ported
// prototype app shell mounted at /, wrapped in .ux-root so its design
// tokens stay scoped to this tree.
export function UxShell() {
  // Controlled: passing onOpenChange alone would suppress the provider's
  // internal state (stock shadcn sidebar semantics).
  const [sidebarOpen, setSidebarOpen] = useState(
    () => sessionStorage.getItem(SIDEBAR_KEY) !== "false",
  );
  return (
    <div className="ux-root min-h-screen bg-background text-foreground">
      <UxPrefsSync />
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
              <AppHeader />
              <main id="main" className="min-w-0 flex-1">
                <Outlet />
              </main>
            </SidebarInset>
          </SidebarProvider>
        </CommandMenuProvider>
      </SessionProvider>
    </div>
  );
}
