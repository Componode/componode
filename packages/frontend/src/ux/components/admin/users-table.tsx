
import { MoreHorizontalIcon, SearchXIcon } from "lucide-react"
import { Link } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { RelativeTime } from "@/ux/components/patterns/primitives"
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

export function UsersTable({ data, selfId }: { data: User[]; selfId: string | null }) {
  const updateUser = useUpdateUser()
  const resetPassword = useResetPassword()
  const [query, setQuery] = React.useState("")
  const [role, setRole] = React.useState("all")

  const visible = data.filter(
    (u) =>
      (role === "all" || u.role === role) &&
      (query === "" || `${u.displayName ?? ""} ${u.email ?? ""} ${u.username}`.toLowerCase().includes(query.toLowerCase())),
  )

  const patch = (u: User, vars: { role?: Role; isActive?: boolean }, success: string) =>
    updateUser.mutate(
      { id: u.id, ...vars },
      { onSuccess: () => toast.success(success), onError: (e) => toast.error(e.message) },
    )

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search name or email"
        resultCount={visible.length}
        total={data.length}
        filters={[
          {
            id: "role",
            label: "Role",
            value: role,
            onChange: setRole,
            options: Object.entries(ROLE_META).map(([value, m]) => ({ value, label: m.label })),
          },
        ]}
      />
      {visible.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={SearchXIcon} title="No users match" description="Try a different search or clear the role filter." />
        </Card>
      ) : (
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-4">User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead className="w-12 pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((u) => {
              const isSelf = u.id === selfId
              return (
                <TableRow key={u.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">{initials(u.displayName ?? u.username)}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          <Link to={ux(`/users/${u.id}`)} className="hover:underline">
                            {u.displayName ?? u.username}
                          </Link>
                          {isSelf && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">{u.email}</span>
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
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.displayName}`}>
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
      )}
    </div>
  )
}
