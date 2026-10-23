
import { Link } from "react-router-dom"
import { useLocation } from "react-router-dom"
import { useSession } from "@/ux/components/app/session-context"
import { canAccess, SETTINGS_NAV } from "@/ux/lib/nav"
import { cn } from "@/ux/lib/utils"

/** Secondary nav: vertical on desktop, horizontally scrollable chips on mobile. Hides sections the role can't access. */
export function SettingsNav() {
  const { pathname } = useLocation()
  const { user } = useSession()
  return (
    <nav aria-label="Settings" className="shrink-0 lg:w-52">
      <div className="flex gap-6 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {SETTINGS_NAV.map((section) => {
          const items = section.items.filter((i) => canAccess(user.role, i.minRole))
          if (items.length === 0) return null
          return (
            <div key={section.label} className="flex flex-col gap-1">
              <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.label}</p>
              <ul className="flex gap-1 lg:flex-col">
                {items.map((item) => {
                  const active = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "block whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                          active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {item.title}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
