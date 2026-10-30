import { ProviderMark } from "@/ux/components/patterns/provider-mark";
import { MoonIcon, PlusIcon, SunIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import * as React from "react"
import { useGlobalSearch } from "@/api/hooks/search"
import { useSession } from "@/ux/components/app/session-context"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/ux/components/ui/command"
import { canAccess, NAV_SECTIONS } from "@/ux/lib/nav"
import type { Provider } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"

const CommandMenuContext = React.createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null)

export function useCommandMenu() {
  const ctx = React.useContext(CommandMenuContext)
  if (!ctx) throw new Error("useCommandMenu must be used inside <CommandMenuProvider>")
  return ctx
}

export function CommandMenuProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])
  return (
    <CommandMenuContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandMenu open={open} setOpen={setOpen} />
    </CommandMenuContext.Provider>
  )
}

function CommandMenu({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const navigate = useNavigate()
  const { user } = useSession()
  const { setTheme } = useTheme()
  const [query, setQuery] = React.useState("")
  const results = useGlobalSearch(query)
  const go = (href: string) => {
    setOpen(false)
    navigate(ux(href))
  }

  const hits = results.data
  const showResults = query.trim().length > 0

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search Componode" description="Jump to a page, product or component">
      <Command shouldFilter={false}>
      <CommandInput
        placeholder="Search products, components, pages…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results. Try a slug, team or provider.</CommandEmpty>
        {showResults && hits ? (
          <>
            {hits.products.length > 0 && (
              <CommandGroup heading="Products">
                {hits.products.map((p) => (
                  <CommandItem key={p.id} value={`product ${p.name} ${p.slug ?? ""}`} onSelect={() => go(`/products/${p.slug ?? p.id}`)}>
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">{(p as { teamOwnerName?: string }).teamOwnerName ?? ""}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {hits.components.length > 0 && (
              <CommandGroup heading="Components">
                {hits.components.map((c) => (
                  <CommandItem key={c.id} value={`component ${c.name}`} onSelect={() => go(`/components/${c.slug ?? c.id}`)}>
                    {"provider" in c && c.provider ? <ProviderMark provider={c.provider as Provider} size="sm" /> : null}
                    <span className="truncate font-mono text-xs">{c.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {(hits.groups.length > 0 || hits.importers.length > 0 || hits.lobs.length > 0 || hits.teams.length > 0) && (
              <CommandGroup heading="More">
                {hits.groups.map((g) => (
                  <CommandItem key={g.id} value={`group ${g.name}`} onSelect={() => go(`/component-groups/${g.slug ?? g.id}`)}>
                    <span className="truncate">{g.name}</span>
                  </CommandItem>
                ))}
                {hits.importers.map((i) => (
                  <CommandItem key={i.id} value={`importer ${i.name}`} onSelect={() => go(`/importers/${i.id}`)}>
                    <span className="truncate">{i.name}</span>
                  </CommandItem>
                ))}
                {hits.lobs.map((l) => (
                  <CommandItem key={l.id} value={`lob ${l.name}`} onSelect={() => go(`/lobs/${l.slug ?? l.id}`)}>
                    <span className="truncate">{l.name}</span>
                  </CommandItem>
                ))}
                {hits.teams.map((t) => (
                  <CommandItem key={t.id} value={`team ${t.name}`} onSelect={() => go(`/teams/${t.slug ?? t.id}`)}>
                    <span className="truncate">{t.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        ) : null}
        <CommandSeparator />
        {canAccess(user.role, "EDITOR") && (
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => go("/products/new")}>
              <PlusIcon />
              Create product
              <CommandShortcut>C P</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => go("/importers/new")}>
              <PlusIcon />
              Add importer
            </CommandItem>
          </CommandGroup>
        )}
        {!showResults && (
          <CommandGroup heading="Navigate">
            {NAV_SECTIONS.flatMap((s) => s.items)
              .filter((i) => canAccess(user.role, i.minRole))
              .map((i) => (
                <CommandItem key={i.href} value={`go ${i.title}`} onSelect={() => { setOpen(false); navigate(i.href) }}>
                  <i.icon />
                  {i.title}
                </CommandItem>
              ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => { setTheme("light"); setOpen(false) }}>
            <SunIcon />
            Light theme
          </CommandItem>
          <CommandItem onSelect={() => { setTheme("dark"); setOpen(false) }}>
            <MoonIcon />
            Dark theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
