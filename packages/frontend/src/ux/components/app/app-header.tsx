
import { MoonIcon, SunIcon } from "lucide-react"
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
import { ux } from "@/ux/lib/paths"
import { useGlobalSearch } from "@/api/hooks/search"

function labelFor(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment
}

/** Resolve a URL segment to an entity display name via global search (exact slug/id match). */
function useEntityName(segment: string): string {
  const isStatic = segment in SEGMENT_LABELS || segment === "ux"
  const search = useGlobalSearch(isStatic ? "" : segment)
  if (isStatic) return labelFor(segment)
  for (const hits of Object.values(search.data ?? {})) {
    const hit = (hits as { name?: string; slug?: string; id?: string }[]).find(
      (h) => h.slug === segment || h.id === segment,
    )
    if (hit?.name) return hit.name
  }
  return segment
}

function useCrumbs() {
  const { pathname } = useLocation()
  const segments = pathname.split("/").filter(Boolean).filter((s) => s !== "ux")
  if (!segments.length) return [{ href: ux("/"), label: "Dashboard", seg: "" }]
  return segments.map((seg, i) => ({
    href: ux(`/${segments.slice(0, i + 1).join("/")}`),
    seg,
    label: "",
  }))
}

function CrumbLabel({ seg }: { seg: string }) {
  return <>{useEntityName(seg)}</>
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
                    <BreadcrumbPage className="truncate">{c.label || <CrumbLabel seg={c.seg} />}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={c.href}>{c.label || <CrumbLabel seg={c.seg} />}</Link>
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
        <ThemeToggle />
      </div>
    </header>
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
