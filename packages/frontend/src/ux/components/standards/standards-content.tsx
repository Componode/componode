
import { KeyRoundIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { EmptyState, ForbiddenState, TableSkeleton } from "@/ux/components/patterns/states"
import {
  AgentCredentialBadge,
  AgentStatusBadge,
  CriticalityBadge,
  EnvironmentBadge,
  HealthBadge,
  RoleBadge,
  RunStatusBadge,
  StatusBadge,
} from "@/ux/components/patterns/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Kbd } from "@/ux/components/ui/kbd"
import { Separator } from "@/ux/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"


const COLORS = [
  { token: "primary", use: "Primary actions, focus, selected nav. Max one primary button per view.", cls: "bg-primary" },
  { token: "foreground", use: "Body text and headings.", cls: "bg-foreground" },
  { token: "muted-foreground", use: "Secondary text, descriptions, timestamps.", cls: "bg-muted-foreground" },
  { token: "canvas", use: "App background behind cards.", cls: "bg-canvas border" },
  { token: "card", use: "Content surfaces.", cls: "bg-card border" },
  { token: "success", use: "Running, completed, active.", cls: "bg-success" },
  { token: "warning", use: "Stopped, expiring soon, needs attention.", cls: "bg-warning" },
  { token: "destructive", use: "Errors, failed runs, irreversible actions.", cls: "bg-destructive" },
  { token: "info", use: "Running jobs, neutral system info.", cls: "bg-info" },
]

const TYPE = [
  { name: "Page title", cls: "text-2xl font-semibold tracking-tight", spec: "24 / 600 / -0.01em" },
  { name: "Section title", cls: "text-base font-semibold", spec: "16 / 600" },
  { name: "Body", cls: "text-sm leading-relaxed", spec: "14 / 400 / 1.6" },
  { name: "Caption", cls: "text-xs text-muted-foreground", spec: "12 / 400 — metadata only" },
  { name: "Mono", cls: "font-mono text-xs", spec: "IDs, ARNs, cron, keys" },
]

const RULES = [
  ["Layout", "Every page = PageContainer → PageHeader → content. Max content width 1400px; settings & forms 768px."],
  ["Lists", "Table + ListToolbar (search, ≤ 3 filters, result count). Row click opens detail. Row actions live in a ⋯ menu at the end."],
  ["Detail", "Header with media, title, badges and ≤ 2 actions. Tabs for sub-resources, deep-linked via ?tab=."],
  ["Create", "≤ 4 fields → Dialog. More → dedicated page. Primary action bottom-right; Cancel to its left."],
  ["Settings", "One SettingsSection card per concern. Toggles save instantly + toast. Text fields require explicit Save, disabled until dirty."],
  ["Destructive", "Always ConfirmDialog. If it destroys data others depend on, require typing the resource slug."],
  ["Secrets", "Show a generated secret once, in a dialog that cannot be dismissed until the user confirms they stored it (EnrollmentTokenPanel). Never offer to view it again; offer rotate instead."],
  ["Danger zone", "Revoke and delete live at the bottom of the detail page, each behind ConfirmDialog. Block delete with an explanation while other resources depend on it."],
  ["Feedback", "Success → toast (sonner). Blocking error → inline Alert. Never use alert()."],
  ["States", "Every async surface designs 4 states: loading (Skeleton), empty (EmptyState + CTA), error (ErrorState + retry), forbidden."],
  ["Status", "Never color text directly. Use StatusBadge with a tone; domain badges map enums → tone in lib/domain.ts."],
  ["Permissions", "Hide navigation the role can't use; disable (with tooltip) actions on visible screens. Server must still enforce."],
  ["Keyboard", "⌘K opens command palette everywhere. Enter submits forms; Esc closes overlays. All controls reachable by Tab."],
  ["Copy", "Sentence case. Verbs on buttons (“Run now”, not “OK”). Explain consequences in confirm dialogs."],
]

export function StandardsContent() {
  return (
    <Tabs defaultValue="foundations" className="gap-6">
      <TabsList>
        <TabsTrigger value="foundations">Foundations</TabsTrigger>
        <TabsTrigger value="patterns">Patterns</TabsTrigger>
        <TabsTrigger value="rules">Rules</TabsTrigger>
      </TabsList>

      <TabsContent value="foundations" className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Color tokens</CardTitle>
            <CardDescription>
              Defined in <code className="font-mono text-xs">app/globals.css</code>. Light and dark are both first-class. Raw palette classes are
              forbidden in product code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COLORS.map((c) => (
                <li key={c.token} className="flex items-start gap-3 rounded-lg border p-3">
                  <span className={`size-10 shrink-0 rounded-md ${c.cls}`} aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <code className="font-mono text-xs font-medium">{c.token}</code>
                    <p className="text-xs leading-relaxed text-muted-foreground">{c.use}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Typography</CardTitle>
            <CardDescription>Geist Sans for UI, Geist Mono for machine values. Numbers in tables use tabular figures (.tabular).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            {TYPE.map((t, i) => (
              <div key={t.name}>
                {i > 0 && <Separator className="my-3" />}
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <span className={t.cls}>{t.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{t.spec}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spacing, radius & motion</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-4 text-sm sm:grid-cols-3">
              <li className="flex flex-col gap-1">
                <span className="font-medium">4px grid</span>
                <span className="leading-relaxed text-muted-foreground">gap-2 inside controls, gap-4 between fields, gap-6 between cards, gap-8 between page regions.</span>
              </li>
              <li className="flex flex-col gap-1">
                <span className="font-medium">Radius 10px</span>
                <span className="leading-relaxed text-muted-foreground">Cards rounded-xl, controls rounded-md, badges rounded-full.</span>
              </li>
              <li className="flex flex-col gap-1">
                <span className="font-medium">150–200ms</span>
                <span className="leading-relaxed text-muted-foreground">Color and opacity only. Respect prefers-reduced-motion.</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="patterns" className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Status badges</CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">components/patterns/status-badge.tsx</code> — one badge per enum, tone from domain metadata.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="neutral" label="Neutral" />
              <StatusBadge tone="success" label="Success" />
              <StatusBadge tone="warning" label="Warning" />
              <StatusBadge tone="destructive" label="Destructive" />
              <StatusBadge tone="info" label="Info" />
              <StatusBadge tone="brand" label="Brand" />
            </div>
            <Separator />
            <div className="flex flex-wrap gap-2">
              <HealthBadge value="RUNNING" />
              <HealthBadge value="STOPPED" />
              <HealthBadge value="ERROR" />
              <RunStatusBadge value="RUNNING" />
              <RunStatusBadge value="FAILED" />
              <CriticalityBadge value="CRITICAL" />
              <EnvironmentBadge value="PRODUCTION" />
              <RoleBadge value="ADMIN" />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>Icon leads the label. One primary per view.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button>
                <PlusIcon data-icon="inline-start" />
                Primary
              </Button>
              <Button variant="outline">Secondary</Button>
              <Button variant="ghost">Tertiary</Button>
              <ConfirmDialog
                trigger={<Button variant="destructive">Destructive</Button>}
                title="Delete this component?"
                description="This removes it from 3 products. Instances remain in your provider."
                confirmLabel="Delete component"
                typeToConfirm="checkout-api"
                onConfirm={() => toast.success("Deleted")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Machine values</CardTitle>
              <CardDescription>Mono, truncated, always copyable.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <MonoValue value="arn:aws:lambda:eu-west-1:4821:function:checkout-api" />
              <div className="flex items-center gap-3 text-sm">
                <ProviderMark provider="AWS" size="sm" />
                <span>Provider mark</span>
                <span className="text-muted-foreground">
                  · <RelativeTime iso={new Date().toISOString()} />
                </span>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                Search anywhere with <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Show-once secret</CardTitle>
              <CardDescription>
                <code className="font-mono text-xs">components/agents/enrollment-token-panel.tsx</code> — for tokens and keys that can never be re-read.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Alert>
                <KeyRoundIcon />
                <AlertTitle>This token is shown once</AlertTitle>
                <AlertDescription>Single use, expires in 24 hours.</AlertDescription>
              </Alert>
              <MonoValue value="cmp_enr_9f2c41a7e0b3d85c6a1f" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Connection status</CardTitle>
              <CardDescription>Credential state wins over live status until the credential is active.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <AgentStatusBadge value="CONNECTED" />
              <AgentStatusBadge value="OFFLINE" />
              <AgentCredentialBadge value="PENDING_ENROLLMENT" />
              <AgentCredentialBadge value="REVOKED" />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Required states</CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">components/patterns/states.tsx</code> — ship all of them for every data surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Loading</p>
              <div className="overflow-hidden rounded-lg border">
                <TableSkeleton rows={3} columns={3} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Empty</p>
              <EmptyState
                className="rounded-lg border"
                title="No components yet"
                description="Connect an importer to discover them."
                action={<Button size="sm">Add importer</Button>}
              />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Forbidden</p>
              <ForbiddenState className="rounded-lg border" />
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="rules">
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-40 pl-6">Area</TableHead>
                <TableHead className="pr-6">Rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RULES.map(([area, rule]) => (
                <TableRow key={area} className="hover:bg-transparent">
                  <TableCell className="pl-6 align-top font-medium">{area}</TableCell>
                  <TableCell className="whitespace-normal pr-6 text-sm leading-relaxed text-muted-foreground">{rule}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
