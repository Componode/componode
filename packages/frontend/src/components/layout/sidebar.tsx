import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Boxes,
  Group,
  Landmark,
  UsersRound,
  Download,
  Users,
  Settings,
  KeyRound,
  LockKeyhole,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useSession } from "@/api/hooks/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavSection {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: "Catalog",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/products", label: "Products", icon: Package },
      { to: "/components", label: "Components", icon: Boxes },
      { to: "/component-groups", label: "Component Groups", icon: Group },
    ],
  },
  {
    label: "Organization",
    items: [
      { to: "/lobs", label: "Lines of Business", icon: Landmark },
      { to: "/teams", label: "Teams", icon: UsersRound },
    ],
  },
  {
    label: "Sources",
    items: [{ to: "/importers", label: "Importers", icon: Download }],
  },
  {
    label: "Administration",
    adminOnly: true,
    items: [
      { to: "/users", label: "Users", icon: Users },
      { to: "/sessions", label: "Sessions", icon: KeyRound },
      { to: "/credentials", label: "Credentials", icon: LockKeyhole },
      { to: "/activity", label: "Activity", icon: Activity },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

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
      return sessionStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  const isAdmin = user?.role === "ADMIN";

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-card transition-[width] duration-200",
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
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
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
          onClick={() => setCollapsed((c) => !c)}
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
