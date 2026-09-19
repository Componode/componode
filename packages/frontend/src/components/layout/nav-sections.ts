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
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export interface NavSection {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
}

/** Single source of truth for app navigation — consumed by the desktop
 *  sidebar and the <md NavDrawer (ADR-108). */
export const SECTIONS: NavSection[] = [
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
