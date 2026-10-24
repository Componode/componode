
import {
  BadgeCheckIcon,
  BookOpenIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  PaletteIcon,
  SearchIcon,
  ShieldIcon,
} from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Logo, LogoMark } from "@/ux/components/app/logo"
import { useLogout } from "@/api/hooks/auth"
import { useSession } from "@/ux/components/app/session-context"
import { Avatar, AvatarFallback } from "@/ux/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ux/components/ui/dropdown-menu"
import { Kbd } from "@/ux/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/ux/components/ui/sidebar"
import { ROLE_META } from "@/ux/lib/domain"
import { initials } from "@/ux/lib/format"
import { canAccess, NAV_SECTIONS } from "@/ux/lib/nav"
import { useCommandMenu } from "./command-menu"
import { ux } from "@/ux/lib/paths"

export function isActivePath(pathname: string, href: string) {
  if (href === ux("/")) return pathname === ux("/") || pathname === `${ux("/")}/`
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppSidebar() {
  const { pathname } = useLocation()
  const { user } = useSession()
  const { setOpen } = useCommandMenu()

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Componode">
              <Link to={ux("/")}>
                <LogoMark className="group-data-[collapsible=icon]:size-8" />
                <span className="flex flex-col leading-none">
                  <span className="text-sm font-semibold">Componode</span>
                  <span className="mt-0.5 text-[11px] text-muted-foreground">Self-hosted</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Search (⌘K)"
              onClick={() => setOpen(true)}
              className="border bg-background text-muted-foreground shadow-xs hover:bg-background"
            >
              <SearchIcon />
              <span>Search…</span>
              <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">⌘K</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((i) => canAccess(user.role, i.minRole))
          if (!items.length) return null
          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActivePath(pathname, item.href)} tooltip={item.title}>
                      <Link to={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function UserMenu() {
  const { user } = useSession()
  const navigate = useNavigate()
  const logout = useLogout()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials(user.displayName ?? user.username)}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-medium">{user.displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{ROLE_META[user.role].label}</span>
              </span>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-64">
            <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
              <span className="text-sm font-medium text-foreground">{user.displayName}</span>
              <span className="text-xs text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link to={ux("/settings/profile")}>
                  <BadgeCheckIcon />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={ux("/settings/security")}>
                  <ShieldIcon />
                  Security
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={ux("/settings/appearance")}>
                  <PaletteIcon />
                  Appearance
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={ux("/standards")}>
                  <BookOpenIcon />
                  Design standard
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => {
                  logout.mutate(undefined, { onSettled: () => navigate(ux("/login")) })
                }}
              >
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export { Logo }
