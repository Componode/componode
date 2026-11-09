import { MoreHorizontalIcon, SearchXIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { SortableTableHead, type ListSortBindings } from "@/ux/components/patterns/sortable-header"
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary"
import { EmptyState } from "@/ux/components/patterns/states"
import { RoleBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { Avatar, AvatarFallback } from "@/ux/components/ui/avatar"
import { Button } from "@/ux/components/ui/button"
import { Card } from "@/ux/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ux/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { ROLE_META, type Role } from "@/ux/lib/domain"
import { initials } from "@/ux/lib/format"
import { useUpdateUser } from "@/api/hooks/users"
import { useResetPassword } from "@/api/hooks/password"
import { flags } from "@/ux/lib/flags"
import { ux } from "@/ux/lib/paths"
import type { User } from "@/ux/lib/view-types"

/**
 * Users table — spec 068: rows arrive one server page at a time; search,
 * role/isActive filters, sort, and pagination are owned by the page's
 * `useListState` + `ListToolbar`/`ListPagination`. Sortable headers cover
 * the contract keys (name, role, isActive, lastActiveAt); `createdAt` is
 * the endpoint default sort and has no column.
 */
export function UsersTable({ data, selfId, sort, order, onSortChange }: { data: User[]; selfId: string | null } & ListSortBindings) {
  const updateUser = useUpdateUser()
  const resetPassword = useResetPassword()

  const patch = (u: User, vars: { role?: Role; isActive?: boolean }, success: string) =>
    updateUser.mutate(
      { id: u.id, ...vars },
      { onSuccess: () => toast.success(success), onError: (e) => toast.error(e.message) },
    )

  if (data.length === 0) {
    return (
      <Card className="py-0">
        <EmptyState icon={SearchXIcon} title="No users match" description="Try a different search or clear the filters." />
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <SortableTableHead sortKey="name" sort={sort} order={order} onSortChange={onSortChange} className="pl-4">
              User
            </SortableTableHead>
            <SortableTableHead sortKey="role" sort={sort} order={order} onSortChange={onSortChange}>
              Role
            </SortableTableHead>
            <SortableTableHead sortKey="isActive" sort={sort} order={order} onSortChange={onSortChange}>
              Status
            </SortableTableHead>
            <SortableTableHead sortKey="lastActiveAt" sort={sort} order={order} onSortChange={onSortChange}>
              Last active
            </SortableTableHead>
            <TableHead className="w-12 pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((u) => {
            const isSelf = u.id === selfId
            const displayName = u.displayName ?? u.username
            return (
              <TableRow key={u.id}>
                <TableCell className="max-w-64 pl-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">{initials(displayName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5 font-medium">
                        <TitleWithSummary
                          title={
                            <Link to={ux(`/users/${u.id}`)} className="hover:underline">
                              {displayName}
                            </Link>
                          }
                          titleText={displayName}
                          summary={{ kind: "user", row: u }}
                          className="truncate"
                        />
                        {isSelf && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <RoleBadge value={u.role} />
                </TableCell>
                <TableCell>
                  {u.isActive ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label="Deactivated" />}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <RelativeTime iso={u.lastActiveAt} />
                </TableCell>
                <TableCell className="pr-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${displayName}`}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel>Role</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={u.role}
                        onValueChange={(v) =>
                          patch(u, { role: v as Role }, `${u.username} is now ${ROLE_META[v as Role].label}`)
                        }
                      >
                        {(Object.keys(ROLE_META) as Role[]).map((r) => (
                          <DropdownMenuRadioItem key={r} value={r} disabled={isSelf}>
                            {ROLE_META[r].label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        {flags.passwordReset && (
                          <DropdownMenuItem
                            disabled={!u.isActive || resetPassword.isPending}
                            onSelect={() =>
                              resetPassword.mutate(
                                { userId: u.id },
                                {
                                  onSuccess: (r) =>
                                    toast.success("Reset link generated", {
                                      description: `Deliver this link to the user: /reset-password?token=${r.resetToken}`,
                                      duration: 30_000,
                                    }),
                                  onError: (e) => toast.error(e.message),
                                },
                              )
                            }
                          >
                            Send password reset
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isSelf}
                          onSelect={() =>
                            patch(u, { isActive: !u.isActive }, u.isActive ? `${u.username} deactivated` : `${u.username} reactivated`)
                          }
                        >
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
