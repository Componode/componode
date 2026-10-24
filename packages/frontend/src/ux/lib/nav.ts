import {
  ActivityIcon,
  BoxesIcon,
  Building2Icon,
  DownloadCloudIcon,
  KeyRoundIcon,
  LayersIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MonitorSmartphoneIcon,
  PackageIcon,
  RadioTowerIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react"
import type { Role } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
  /** Minimum role. Hide (don't disable) items the user cannot reach. */
  minRole?: Role
  }

export interface NavSection {
  label: string
  items: NavItem[]
}

/** One source of truth for sidebar + ⌘K navigation. minRole hides the entry only; routes/APIs remain the enforcement. */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: ux("/"), icon: LayoutDashboardIcon }],
  },
  {
    label: "Catalog",
    items: [
      { title: "Products", href: ux("/products"), icon: PackageIcon },
      { title: "Components", href: ux("/components"), icon: BoxesIcon },
      { title: "Component groups", href: ux("/component-groups"), icon: LayersIcon },
      { title: "Suggestions", href: ux("/suggestions"), icon: SparklesIcon },
    ],
  },
  {
    label: "Organization",
    items: [
      { title: "Lines of business", href: ux("/lobs"), icon: Building2Icon },
      { title: "Teams", href: ux("/teams"), icon: UsersRoundIcon },
    ],
  },
  {
    label: "Sources",
    items: [
      { title: "Importers", href: ux("/importers"), icon: DownloadCloudIcon },
      { title: "Import agents", href: ux("/agents"), icon: RadioTowerIcon, minRole: "ADMIN" },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Users", href: ux("/users"), icon: UsersIcon, minRole: "ADMIN" },
      { title: "Sessions", href: ux("/sessions"), icon: MonitorSmartphoneIcon },
      { title: "Credentials", href: ux("/credentials"), icon: KeyRoundIcon, minRole: "ADMIN" },
      { title: "Activity", href: ux("/activity"), icon: ActivityIcon, minRole: "ADMIN" },
      { title: "Settings", href: ux("/settings"), icon: SettingsIcon },
    ],
  },
]

export const SETTINGS_NAV: NavSection[] = [
  {
    label: "Personal",
    items: [
      { title: "Profile", href: ux("/settings/profile"), icon: SettingsIcon },
      { title: "Appearance", href: ux("/settings/appearance"), icon: SettingsIcon },
      { title: "Security", href: ux("/settings/security"), icon: SettingsIcon },
      { title: "Notifications", href: ux("/settings/notifications"), icon: SettingsIcon },
    ],
  },
  {
    label: "Workspace",
    items: [
      { title: "General", href: ux("/settings/workspace"), icon: SettingsIcon, minRole: "ADMIN" },
      { title: "Authentication", href: ux("/settings/authentication"), icon: SettingsIcon, minRole: "ADMIN" },
      { title: "Session policy", href: ux("/settings/session-policy"), icon: SettingsIcon, minRole: "ADMIN" },
      { title: "Advanced", href: ux("/settings/advanced"), icon: SettingsIcon, minRole: "ADMIN" },
    ],
  },
]

const ROLE_RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 }
export const canAccess = (role: Role, min?: Role) => !min || ROLE_RANK[role] >= ROLE_RANK[min]

export const SEGMENT_LABELS: Record<string, string> = {
  products: "Products",
  components: "Components",
  "component-groups": "Component groups",
  suggestions: "Suggestions",
  lobs: "Lines of business",
  teams: "Teams",
  importers: "Importers",
  agents: "Import agents",
  users: "Users",
  sessions: "Sessions",
  credentials: "Credentials",
  activity: "Activity",
  settings: "Settings",
  profile: "Profile",
  appearance: "Appearance",
  security: "Security",
  notifications: "Notifications",
  workspace: "General",
  authentication: "Authentication",
  "session-policy": "Session policy",
  advanced: "Advanced",
  new: "New",
  edit: "Edit",
  import: "Import",
  history: "History",
  promote: "Promote",
}
