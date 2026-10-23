
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
import { currentUser, type User } from "@/ux/lib/mock-data"

export function UsersTable({ data }: { data: User[] }) {
  const [rows, setRows] = React.useState(data)
  const [query, setQuery] = React.useState("")
  const [role, setRole] = React.useState("all")

  const visible = rows.filter(
    (u) =>
      (role === "all" || u.role === role) &&
      (query === "" || `${u.displayName} ${u.email} ${u.username}`.toLowerCase().includes(query.toLowerCase())),
  )

  const update = (id: string, patch: Partial<User>) => setRows((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search name or email"
        resultCount={visible.length}
        total={rows.length}
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
              const isSelf = u.id === currentUser.id
              return (
                <TableRow key={u.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">{initials(u.displayName ?? u.username)}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          <Link to={`/users/${u.id}`} className="hover:underline">
                            {u.displayName}
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
                          onValueChange={(v) => {
                            update(u.id, { role: v as Role })
                            toast.success(`${u.displayName} is now ${ROLE_META[v as Role].label}`)
                          }}
                        >
                          {(Object.keys(ROLE_META) as Role[]).map((r) => (
                            <DropdownMenuRadioItem key={r} value={r} disabled={isSelf}>
                              {ROLE_META[r].label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem onSelect={() => toast.success("Password reset link sent")}>Send password reset</DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isSelf}
                            onSelect={() => {
                              update(u.id, { isActive: !u.isActive })
                              toast.success(u.isActive ? `${u.displayName} deactivated` : `${u.displayName} reactivated`)
                            }}
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
