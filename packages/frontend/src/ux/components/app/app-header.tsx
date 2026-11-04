
import { BellIcon, CircleHelpIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react"
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
import { ExternalLink } from "@/ux/components/patterns/external-link"

const DOCS_URL = "https://componode.github.io/componode/"

function labelFor(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment
}

/** Detail pages register labels keyed by URL segment so crumbs show entity
 *  names instead of raw ids — needed for UUID-keyed segments (users,
 *  sources, checks, importer configs) that global search can't resolve. */
const CrumbLabelsContext = React.createContext<{
  labels: Record<string, string>
  set: (seg: string, label: string | null) => void
} | null>(null)

export function CrumbLabelsProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = React.useState<Record<string, string>>({})
  const set = React.useCallback(
    (seg: string, label: string | null) =>
      setLabels((m) => {
        if (label == null) {
          if (!(seg in m)) return m
          const n = { ...m }
          delete n[seg]
          return n
        }
        return m[seg] === label ? m : { ...m, [seg]: label }
      }),
    [],
  )
  const value = React.useMemo(() => ({ labels, set }), [labels, set])
  return <CrumbLabelsContext.Provider value={value}>{children}</CrumbLabelsContext.Provider>
}

export function useCrumbLabel(segment: string | undefined, label: string | null | undefined) {
  const ctx = React.useContext(CrumbLabelsContext)
  React.useEffect(() => {
    if (!segment) return
    ctx?.set(segment, label ?? null)
    return () => ctx?.set(segment, null)
  }, [ctx, segment, label])
}

/** Label the trailing path segment — the common detail-page case. */
export function useLeafCrumb(label: string | null | undefined) {
  const { pathname } = useLocation()
  const leaf = pathname.split("/").filter(Boolean).filter((s) => s !== "ux").at(-1)
  useCrumbLabel(leaf, label)
}

/** Resolve a URL segment to an entity display name via global search (exact slug/id match). */
function useEntityName(segment: string): string {
  const custom = React.useContext(CrumbLabelsContext)?.labels[segment]
  const isStatic = segment in SEGMENT_LABELS || segment === "ux"
  const search = useGlobalSearch(isStatic || custom ? "" : segment)
  if (custom) return custom
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
        <HeaderIconButton label="Help & docs" icon={CircleHelpIcon} kind="external" href={DOCS_URL} />
        <HeaderIconButton label="Notifications" icon={BellIcon} kind="internal" to="/settings/notifications" />
        <ThemeToggle />
      </div>
    </header>
  )
}

type HeaderIconDestination =
  | { kind: "internal"; to: string }
  | { kind: "external"; href: string }

function HeaderIconButton({
  label,
  icon: Icon,
  ...destination
}: { label: string; icon: LucideIcon } & HeaderIconDestination) {
  const icon = <Icon />
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} asChild>
          {destination.kind === "external" ? (
            <ExternalLink href={destination.href}>{icon}</ExternalLink>
          ) : (
            <Link to={ux(destination.to)}>{icon}</Link>
          )}
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
