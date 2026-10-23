
import { HistoryIcon, MonitorSmartphoneIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useValidatedTab } from "@/ux/lib/use-validated-tab"
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
import { useUpdateUser } from "@/api/hooks/users"
import { useRevokeSession } from "@/api/hooks/sessions"
import { useResetPassword } from "@/api/hooks/password"
import { flags } from "@/ux/lib/flags"
import type { AuditEvent, Session, User } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"

const TABS = ["overview", "sessions", "activity"]

interface UserDetailProps {
  user: User
  sessions: Session[]
  events: AuditEvent[]
  isSelf: boolean
}

export function UserDetail({ user, sessions, events, isSelf }: UserDetailProps) {
  const [tab, setTab] = useValidatedTab(TABS)

  const updateUser = useUpdateUser()
  const revokeSession = useRevokeSession()
  const resetPassword = useResetPassword()
  const [role, setRole] = React.useState<Role>(user.role)

  // Re-sync the draft role when the live row changes.
  React.useEffect(() => setRole(user.role), [user.role])
  const roleDirty = role !== user.role


  return (
    <PageContainer>
      <PageHeader
        media={
          <Avatar className="size-12">
            <AvatarFallback>{initials(user.displayName ?? user.username)}</AvatarFallback>
          </Avatar>
        }
        title={user.displayName ?? user.username}
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
          flags.passwordReset ? (
            <Button
              variant="outline"
              disabled={!user.isActive || resetPassword.isPending}
              onClick={() =>
                resetPassword.mutate(
                  { userId: user.id },
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
            </Button>
          ) : null
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
                disabled={!roleDirty || updateUser.isPending}
                onClick={() =>
                  updateUser.mutate(
                    { id: user.id, role },
                    {
                      onSuccess: () => toast.success(`${user.username} is now ${ROLE_META[role].label}`),
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
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
                            onConfirm={() =>
                              revokeSession.mutate(s.id, {
                                onSuccess: () => toast.success("Session revoked"),
                                onError: (e) => toast.error(e.message),
                              })
                            }
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
            confirmTitle: `${user.isActive ? "Deactivate" : "Reactivate"} ${user.displayName ?? user.username}?`,
            confirmDescription: user.isActive
              ? "They are signed out everywhere and cannot sign in until reactivated."
              : "They can sign in again with their previous role.",
            confirmLabel: user.isActive ? "Deactivate" : "Reactivate",
            blockedReason: isSelf ? "You cannot deactivate your own account." : undefined,
            onConfirm: () =>
              updateUser.mutate(
                { id: user.id, isActive: !user.isActive },
                { onError: (e) => toast.error(e.message) },
              ),
            successMessage: user.isActive ? `${user.username} deactivated` : `${user.username} reactivated`,
          },
        ]}
      />
    </PageContainer>
  )
}
