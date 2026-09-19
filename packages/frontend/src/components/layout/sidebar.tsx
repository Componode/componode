import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Boxes, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSession } from "@/api/hooks/auth";
import { cn } from "@/lib/utils";
import { SECTIONS } from "./nav-sections";

const STORAGE_KEY = "sidebar-collapsed";

/**
 * Persistent left sidebar per docs/ux.md §3: grouped sections, active-route
 * highlight, collapsible to icons (persisted in sessionStorage per FR-002),
 * Administration section gated on ADMIN role.
 */
export function Sidebar() {
  const { data: user } = useSession();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored !== null) return stored === "true";
    } catch {
      /* storage unavailable — fall through to the width-based default */
    }
    try {
      // No explicit preference: default to the icon rail below `lg`
      // (docs/ux.md §9). Evaluated once on mount, never on resize.
      return window.matchMedia("(max-width: 1023.98px)").matches;
    } catch {
      return false;
    }
  });

  // Persist only explicit choices — a width-based default must not become
  // a stored preference (it would then beat the viewport on later loads).
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        sessionStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  // Ctrl+B dispatch target (see lib/use-sidebar-shortcut.ts) — same event
  // convention as componode:open-palette.
  useEffect(() => {
    const handler = () => toggleCollapsed();
    window.addEventListener("componode:toggle-sidebar", handler);
    return () => window.removeEventListener("componode:toggle-sidebar", handler);
  }, []);

  const isAdmin = user?.role === "ADMIN";

  return (
    <aside
      className={cn(
        // Below md the NavDrawer replaces this chrome entirely (ADR-108).
        "hidden h-full flex-col border-r bg-card transition-[width] duration-200 md:flex",
        collapsed ? "w-14" : "w-56",
      )}
      data-testid="sidebar"
      data-collapsed={collapsed}
    >
      <div
        className={cn(
          "flex h-14 items-center border-b px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <NavLink to="/" className="flex items-center gap-2 font-bold" aria-label="Componode home">
          <Boxes className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!collapsed && <span>Componode</span>}
        </NavLink>
      </div>

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Main">
        {SECTIONS.map((section) => {
          if (section.adminOnly && !isAdmin) return null;
          return (
            <div key={section.label} className="mb-4" data-section={section.label}>
              {!collapsed && (
                <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            collapsed && "justify-center px-0",
                            isActive && "bg-accent font-medium",
                          )
                        }
                      >
                        <span className="icon-well">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t p-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
