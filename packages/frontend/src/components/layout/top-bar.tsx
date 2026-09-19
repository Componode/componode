import { useNavigate } from "react-router-dom";
import { LogOut, Menu, Search } from "lucide-react";
import { SheetTrigger } from "@/components/ui/sheet";
import { useSession, useLogout } from "@/api/hooks/auth";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Slim top bar per docs/ux.md §3: breadcrumbs / page context on the left,
 * theme toggle + user identity + sign-out on the right.
 */
export function TopBar() {
  const { data: user } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await logout.mutateAsync();
    } catch {
      /* still redirect even if the call fails */
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-background px-6">
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation"
          className="-ml-2 flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </SheetTrigger>
      <Breadcrumbs />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new Event("componode:open-palette"))
          }
          className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open search"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Search…</span>
          <kbd className="hidden rounded border bg-background px-1 text-[10px] sm:inline">
            Ctrl+K
          </kbd>
        </button>
        <ThemeToggle />
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2" aria-label="User menu">
                <span className="text-sm">{user.username}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {user.role}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="font-normal text-muted-foreground">
                Signed in as {user.username}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} disabled={logout.isPending}>
                <LogOut aria-hidden="true" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
