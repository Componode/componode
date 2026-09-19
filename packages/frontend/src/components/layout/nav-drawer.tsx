import { NavLink } from "react-router-dom";
import { Boxes } from "lucide-react";
import { useSession } from "@/api/hooks/auth";
import { SECTIONS } from "./nav-sections";
import {
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

/**
 * Mobile navigation drawer content (ADR-108): off-canvas Sheet below `md`
 * only, rendering the same grouped sections as the desktop sidebar. The
 * owning `Sheet` root lives in AppShell and the hamburger is a
 * `SheetTrigger` in TopBar — one Radix tree, so focus trap + focus return
 * to the trigger come from the primitive. Content and overlay carry
 * `md:hidden` so a viewport crossover can never show drawer and sidebar
 * chrome at once; AppShell also clears `open` on `>=md`.
 */
export function NavDrawer({ onNavigate }: { onNavigate: () => void }) {
  const { data: user } = useSession();
  const isAdmin = user?.role === "ADMIN";

  return (
    <SheetContent
      side="left"
      className="flex w-64 flex-col p-0 md:hidden"
      overlayClassName="md:hidden"
      aria-label="Navigation"
    >
      <SheetHeader className="flex h-14 flex-row items-center border-b px-4">
        <Boxes className="h-5 w-5 shrink-0" aria-hidden="true" />
        <SheetTitle className="font-bold">Componode</SheetTitle>
        <SheetDescription className="sr-only">
          Site navigation
        </SheetDescription>
      </SheetHeader>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Mobile">
        {SECTIONS.map((section) => {
          if (section.adminOnly && !isAdmin) return null;
          return (
            <div key={section.label} className="mb-4" data-section={section.label}>
              <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === "/"}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring${isActive ? " bg-accent font-medium" : ""}`
                        }
                      >
                        <span className="icon-well">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </SheetContent>
  );
}
