import { Outlet } from "react-router-dom";
import { AppHeader } from "@/ux/components/app/app-header";
import { AppSidebar } from "@/ux/components/app/app-sidebar";
import { CommandMenuProvider } from "@/ux/components/app/command-menu";
import { SessionProvider } from "@/ux/components/app/session-context";
import { SidebarInset, SidebarProvider } from "@/ux/components/ui/sidebar";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import "./styles.css";

const SIDEBAR_KEY = "ux_sidebar_state";

// Staged shell for the v1.1.0 UX rewrite (spec 029): the ported prototype
// app shell mounted under /ux, wrapped in .ux-root so its design tokens stay
// scoped to this tree. Removed at cutover (T045) when this becomes the root.
export function UxShell() {
  return (
    <div className="ux-root min-h-screen bg-background text-foreground">
      <SessionProvider>
        <CommandMenuProvider>
          <TooltipProvider>
          <SidebarProvider
            defaultOpen={localStorage.getItem(SIDEBAR_KEY) !== "false"}
            onOpenChange={(open) => localStorage.setItem(SIDEBAR_KEY, String(open))}
          >
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <AppHeader />
              <main id="main" className="min-w-0 flex-1">
                <Outlet />
              </main>
            </SidebarInset>
          </SidebarProvider>
          </TooltipProvider>
        </CommandMenuProvider>
      </SessionProvider>
    </div>
  );
}
