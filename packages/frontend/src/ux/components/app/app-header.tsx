
import { BellIcon, CircleHelpIcon, MoonIcon, SunIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useLocation } from "react-router-dom"
import { useTheme } from "next-themes"
import * as React from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/ux/components/ui/breadcrumb"
import { Button } from "@/ux/components/ui/button"
import { Separator } from "@/ux/components/ui/separator"
import { SidebarTrigger } from "@/ux/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ux/components/ui/tooltip"
import { SEGMENT_LABELS } from "@/ux/lib/nav"

// Entity names in breadcrumbs are a staged-UX gap (gap registry): the shell
// renders the URL segment until detail pages can publish resolved titles.
function labelFor(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment
}

function useCrumbs() {
  const { pathname } = useLocation()
  // The staged tree lives under /ux — drop the mount segment from the trail.
  const segments = pathname.split("/").filter(Boolean).filter((s) => s !== "ux")
  if (!segments.length) return [{ href: "/ux", label: "Dashboard" }]
  return segments.map((seg, i) => ({
    href: `/ux/${segments.slice(0, i + 1).join("/")}`,
    label: labelFor(seg),
  }))
}

export function AppHeader() {
  const crumbs = useCrumbs()
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur md:rounded-t-xl">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <React.Fragment key={c.href}>
                <BreadcrumbItem className={last ? "min-w-0" : "hidden md:inline-flex"}>
                  {last ? (
                    <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={c.href}>{c.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!last && <BreadcrumbSeparator className="hidden md:block" />}
              </React.Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-1">
        <HeaderIconButton label="Help & docs" icon={CircleHelpIcon} />
        <HeaderIconButton label="Notifications" icon={BellIcon} dot />
        <ThemeToggle />
      </div>
    </header>
  )
}

function HeaderIconButton({ label, icon: Icon, dot }: { label: string; icon: typeof BellIcon; dot?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} className="relative">
          <Icon />
          {dot && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive" aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <SunIcon className="dark:hidden" />
          <MoonIcon className="hidden dark:block" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Toggle theme</TooltipContent>
    </Tooltip>
  )
}
