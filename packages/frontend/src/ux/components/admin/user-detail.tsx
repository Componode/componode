
import { HistoryIcon, MonitorSmartphoneIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { DangerZone } from "@/ux/components/patterns/danger-zone"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { RoleBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Avatar, AvatarFallback } from "@/ux/components/ui/avatar"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/ux/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { ROLE_META, type Role } from "@/ux/lib/domain"
import { formatDate, formatDateTime, initials } from "@/ux/lib/format"
import type { AuditEvent, Session, User } from "@/ux/lib/mock-data"
import { ux } from "@/ux/lib/paths"

const TABS = ["overview", "sessions", "activity"]

interface UserDetailProps {
  initial: User
  sessions: Session[]
  events: AuditEvent[]
  isSelf: boolean
}

export function UserDetail({ initial, sessions: initialSessions, events, isSelf }: UserDetailProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get("tab")
  const tab = requestedTab && TABS.includes(requestedTab) ? requestedTab : "overview"

  const [user, setUser] = React.useState(initial)
  const [role, setRole] = React.useState<Role>(initial.role)
  const [sessions, setSessions] = React.useState(initialSessions)
  const roleDirty = role !== user.role

  const setTab = (value: string) => navigate(`${pathname}?tab=${value}`, { replace: true })

  return (
    <PageContainer>
      <PageHeader
        media={
          <Avatar className="size-12">
            <AvatarFallback>{initials(user.displayName ?? user.username)}</AvatarFallback>
          </Avatar>
        }
        title={user.displayName}
        description={user.email}
        meta={
          <>
            <RoleBadge value={user.role} />
            {user.isActive ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label="Deactivated" />}
            {isSelf && <StatusBadge tone="info" label="You" />}
            <code className="font-mono text-xs text-muted-foreground">@{user.username}</code>
          </>
        }
        actions={
          <Button
            variant="outline"
            onClick={() => toast.success("Password reset link sent", { description: "Prototype only. No email was sent." })}
            disabled={!user.isActive}
          >
            Send password reset
          </Button>
        }
      />

      {!user.isActive && (
        <Alert>
          <AlertTitle>This account is deactivated</AlertTitle>
          <AlertDescription>The user cannot sign in and all sessions were ended. Reactivate the account to restore access.</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({sessions.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Identity comes from your sign-in provider and is read-only here.</CardDescription>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "User ID", value: <MonoValue value={user.id} /> },
                  { label: "Username", value: <span className="font-mono text-sm">{user.username}</span> },
                  { label: "Email", value: user.email },
                  { label: "Last active", value: <RelativeTime iso={user.lastActiveAt} /> },
                  { label: "Member since", value: formatDate(user.createdAt) },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Role</CardTitle>
              <CardDescription>Controls what this person can change across the workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <Field>
                <FieldLabel htmlFor="role">Workspace role</FieldLabel>
                <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={isSelf}>
                  <SelectTrigger id="role" className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(Object.keys(ROLE_META) as Role[]).map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_META[r].label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {isSelf ? "You cannot change your own role. Ask another admin." : ROLE_META[role].description}
                </FieldDescription>
              </Field>
            </CardContent>
            <CardFooter className="justify-end gap-2 border-t">
              <Button variant="ghost" disabled={!roleDirty} onClick={() => setRole(user.role)}>
                Discard
              </Button>
              <Button
                disabled={!roleDirty}
                onClick={() => {
                  setUser((u) => ({ ...u, role }))
                  toast.success(`${user.displayName} is now ${ROLE_META[role].label}`)
                }}
              >
                Save role
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <Card className="overflow-hidden py-0">
            {sessions.length === 0 ? (
              <EmptyState icon={MonitorSmartphoneIcon} title="No active sessions" description="This user is signed out everywhere." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Device</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-24 pr-4">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.device}</span>
                          {s.current && isSelf && <StatusBadge tone="success" label="This device" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.location}</TableCell>
                      <TableCell className="text-sm">
                        <RelativeTime iso={s.lastSeenAt} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(s.expiresAt)}</TableCell>
                      <TableCell className="pr-4 text-right">
                        {!(s.current && isSelf) && (
                          <ConfirmDialog
                            trigger={
                              <Button variant="ghost" size="sm">
                                Revoke
                              </Button>
                            }
                            title="Revoke this session?"
                            description={`${s.device} is signed out immediately.`}
                            confirmLabel="Revoke session"
                            onConfirm={() => {
                              setSessions((prev) => prev.filter((x) => x.id !== s.id))
                              toast.success("Session revoked")
                            }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent>
              {events.length === 0 ? (
                <EmptyState icon={HistoryIcon} title="No activity recorded" description="Changes made by this user show up here." />
              ) : (
                <ActivityFeed events={events} />
              )}
            </CardContent>
            <CardFooter className="border-t">
              <Button variant="link" asChild className="px-0">
                <Link to={ux("/activity")}>Open full audit log</Link>
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <DangerZone
        actions={[
          {
            id: "deactivate",
            title: user.isActive ? "Deactivate account" : "Reactivate account",
            description: user.isActive
              ? "Ends every session and blocks sign-in. Their audit history is kept."
              : "Restores sign-in with the existing role.",
            buttonLabel: user.isActive ? "Deactivate" : "Reactivate",
            confirmTitle: `${user.isActive ? "Deactivate" : "Reactivate"} ${user.displayName}?`,
            confirmDescription: user.isActive
              ? "They are signed out everywhere and cannot sign in until reactivated."
              : "They can sign in again with their previous role.",
            confirmLabel: user.isActive ? "Deactivate" : "Reactivate",
            blockedReason: isSelf ? "You cannot deactivate your own account." : undefined,
            onConfirm: () => {
              if (user.isActive) setSessions([])
              setUser((u) => ({ ...u, isActive: !u.isActive }))
            },
            successMessage: user.isActive ? `${user.displayName} deactivated` : `${user.displayName} reactivated`,
          },
        ]}
      />
    </PageContainer>
  )
}
