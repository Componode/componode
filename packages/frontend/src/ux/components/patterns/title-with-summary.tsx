import { Fragment } from "react"
import type * as React from "react"
import { ux } from "@/ux/lib/paths"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ux/components/ui/hover-card"
import type { LobListItem, TeamListItem } from "@/api/types"
import {
  AgentStatusBadge,
  CredentialStatusBadge,
  CriticalityBadge,
  HealthBadge,
  LifecycleBadge,
  ProductTypeBadge,
  RoleBadge,
  RunStatusBadge,
  StatusBadge,
} from "@/ux/components/patterns/status-badge"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import {
  CATEGORY_LABELS,
  PROVIDER_META,
  SOURCE_STATUS_META,
  type SourceStatus,
} from "@/ux/lib/domain"
import { formatDuration } from "@/ux/lib/format"
import type {
  AuditEvent,
  Component,
  ComponentGroupView,
  Credential,
  ImportAgent,
  ImporterConfig,
  ImporterSource,
  ImportRun,
  Product,
  Suggestion,
  User,
} from "@/ux/lib/view-types"
import { cn } from "@/ux/lib/utils"

/**
 * Title-cell hover summary (spec 068 US4 / data-model.md "Item Summary").
 *
 * HARD RULE: summary fields are an explicit per-entity allowlist curated
 * below — they must NEVER render secrets, credential values, session
 * tokens, or raw importer `details` JSON. Credential rows expose only the
 * already-masked `keyHints`; everything else reads plain list-row fields.
 * Content comes from the list payload — no additional request (SC-006).
 */

export interface SummaryField {
  label: string
  value: React.ReactNode
  /** Full-width row (label above value) — for prose values like descriptions. */
  wide?: boolean
}

const Dash = () => <span className="text-muted-foreground">—</span>
const text = (v: string | null | undefined): React.ReactNode => (v ? v : <Dash />)
const count = (n: number): React.ReactNode => <span className="tabular">{n}</span>

/** Row shapes the registry understands — view types where they exist, the
 *  API org list rows the org pages already consume. */
export interface SummaryRowMap {
  component: Component
  product: Product
  componentGroup: ComponentGroupView
  user: User
  team: TeamListItem
  lob: LobListItem
  agent: ImportAgent
  credential: Credential
  importerSource: ImporterSource
  importerConfig: ImporterConfig
  importRun: ImportRun
  edgeSuggestion: Suggestion
  audit: AuditEvent
  /**
   * Fallback for rows without a curated kind — emits whichever generic
   * identity/timestamp fields are present (name, slug, created, updated).
   * An empty object yields no fields, so `TitleWithSummary` renders the
   * plain title without a card.
   */
  generic: {
    name?: string | null
    slug?: string | null
    createdAt?: string | null
    updatedAt?: string | null
  }
}

export type SummaryKind = keyof SummaryRowMap

const SUGGESTION_KIND_LABEL: Record<Suggestion["kind"], string> = {
  COMPOSES: "composes",
  DEPENDS_ON: "depends on",
  CONSUMES_FROM: "consumes from",
}

function sourceStatusNode(value: string): React.ReactNode {
  const meta =
    SOURCE_STATUS_META[value as SourceStatus] ??
    ({ label: value, description: "Unrecognized status reported by the API", tone: "neutral" } as const)
  return <StatusBadge tone={meta.tone} label={meta.label} description={meta.description} />
}

/**
 * Curated per-entity summary fields (data-model.md). Each extractor is an
 * explicit allowlist — add fields deliberately, never pass row objects
 * through wholesale.
 */
export const SUMMARY_FIELDS: {
  [K in SummaryKind]: (row: SummaryRowMap[K]) => SummaryField[]
} = {
  component: (c) => [
    { label: "Provider", value: PROVIDER_META[c.provider]?.label ?? c.provider },
    { label: "Category", value: CATEGORY_LABELS[c.category] ?? c.category },
    {
      label: "Resource type",
      value: <code className="font-mono text-xs">{c.resourceType}</code>,
    },
    {
      label: "Owner",
      value: c.teamOwnerName ?? <span className="text-muted-foreground">Unowned</span>,
    },
    {
      label: "Groups",
      value:
        c.componentGroups.length > 0 ? (
          <span className="break-words">
            {c.componentGroups.map((g, i) => (
              <Fragment key={g.id}>
                {i > 0 && ", "}
                <a href={ux(`/component-groups/${g.slug}`)} className="text-primary hover:underline">
                  {g.name}
                </a>
              </Fragment>
            ))}
          </span>
        ) : (
          text(null)
        ),
    },
    { label: "Lifecycle", value: <LifecycleBadge value={c.lifecycle} /> },
    { label: "Instances", value: count(c.instanceCount) },
    { label: "Health", value: <HealthBadge value={c.worstStatus} /> },
    { label: "Last seen", value: <RelativeTime iso={c.lastSeenAt} /> },
    {
      label: "Tags",
      value: c.tags.length > 0 ? <span className="break-words">{c.tags.join(", ")}</span> : <Dash />,
      wide: true,
    },
  ],
  product: (p) => [
    {
      label: "Description",
      value: p.description ? (
        <span className="line-clamp-3">{p.description}</span>
      ) : (
        <Dash />
      ),
      wide: true,
    },
    { label: "Type", value: <ProductTypeBadge value={p.type} /> },
    {
      label: "Owner",
      value: (
        <span className="flex flex-col">
          <span>{p.teamOwnerName ?? <span className="text-muted-foreground">Unowned</span>}</span>
          {p.lobOwnerName && <span className="text-xs text-muted-foreground">{p.lobOwnerName}</span>}
        </span>
      ),
    },
    { label: "Criticality", value: <CriticalityBadge value={p.criticality} /> },
    {
      label: "Health",
      value:
        p.lifecycle === "RETIRED" ? (
          <LifecycleBadge value="RETIRED" />
        ) : (
          <HealthBadge value={p.status} />
        ),
    },
    { label: "Components", value: count(p.componentCount) },
    { label: "Updated", value: <RelativeTime iso={p.updatedAt} /> },
  ],
  componentGroup: (g) => [
    {
      label: "Description",
      value: g.description ? <span className="line-clamp-3">{g.description}</span> : <Dash />,
      wide: true,
    },
    { label: "Lifecycle", value: <LifecycleBadge value={g.lifecycle} /> },
    { label: "Members", value: count(g.members) },
    { label: "Owner", value: text(g.team) },
  ],
  user: (u) => [
    { label: "Role", value: <RoleBadge value={u.role} /> },
    { label: "Status", value: u.isActive ? "Active" : "Inactive" },
    { label: "Last active", value: <RelativeTime iso={u.lastActiveAt} /> },
    { label: "Created", value: <RelativeTime iso={u.createdAt} /> },
  ],
  team: (t) => [
    {
      label: "Description",
      value: t.description ? <span className="line-clamp-3">{t.description}</span> : <Dash />,
      wide: true,
    },
    { label: "Line of business", value: text(t.lob?.name) },
    { label: "Members", value: count(t.memberCount) },
    { label: "Products", value: t.productCount != null ? count(t.productCount) : <Dash /> },
    { label: "Components", value: count(t.componentCount) },
  ],
  lob: (l) => [
    {
      label: "Description",
      value: l.description ? <span className="line-clamp-3">{l.description}</span> : <Dash />,
      wide: true,
    },
    { label: "Teams", value: l.teamCount != null ? count(l.teamCount) : <Dash /> },
    { label: "Products", value: l.productCount != null ? count(l.productCount) : <Dash /> },
  ],
  agent: (a) => [
    { label: "Status", value: <AgentStatusBadge value={a.status} /> },
    {
      label: "Version",
      value: a.agentVersion ? (
        <code className="font-mono text-xs">{a.agentVersion}</code>
      ) : (
        <Dash />
      ),
    },
    { label: "Bound configs", value: count(a.boundConfigs) },
    {
      label: "Importers",
      value:
        a.allowedImporters.length > 0 ? (
          <span className="break-words">{a.allowedImporters.join(", ")}</span>
        ) : (
          "All compiled"
        ),
      wide: true,
    },
    { label: "Last seen", value: <RelativeTime iso={a.lastSeenAt} /> },
  ],
  credential: (c) => {
    // keyHints are already masked server-side — the only credential detail
    // a summary may show (never `secrets`, which the view type doesn't carry).
    const hints = Object.entries(c.keyHints)
    return [
      { label: "Status", value: <CredentialStatusBadge value={c.status} /> },
      {
        label: "Key hint",
        value:
          hints.length > 0 ? (
            <code className="font-mono text-xs break-all">
              {hints.map(([k, v]) => `${k}: ${v}`).join(", ")}
            </code>
          ) : (
            <Dash />
          ),
        wide: true,
      },
      { label: "Expires", value: <RelativeTime iso={c.expiresAt} /> },
      { label: "Last used", value: <RelativeTime iso={c.lastUsedAt} /> },
      { label: "Used by", value: count(c.usedBy) },
    ]
  },
  importerSource: (s) => [
    {
      label: "Importer",
      value: (
        <span className="inline-flex items-baseline gap-1.5">
          {PROVIDER_META[s.provider]?.label ?? s.importerName}
          <code className="font-mono text-xs text-muted-foreground">{s.importerName}</code>
        </span>
      ),
    },
    { label: "Status", value: sourceStatusNode(s.status) },
    { label: "Bound config", value: text(s.boundConfig?.label) },
    { label: "Components", value: count(s.activeComponentMemberships) },
    { label: "Instances", value: count(s.activeInstanceMemberships) },
    { label: "Last complete run", value: <RelativeTime iso={s.lastCompletedRunAt} /> },
  ],
  importerConfig: (c) => [
    { label: "Importer", value: PROVIDER_META[c.importerName]?.label ?? c.importerName },
    { label: "Status", value: c.enabled ? "Enabled" : "Disabled" },
    { label: "Schedule", value: text(c.scheduleLabel) },
    {
      label: "Last run",
      value: c.lastRun ? (
        <span className="inline-flex items-center gap-2">
          <RunStatusBadge value={c.lastRun.status} />
          <RelativeTime iso={c.lastRun.at} />
        </span>
      ) : (
        <Dash />
      ),
    },
  ],
  importRun: (r) => [
    { label: "Status", value: <RunStatusBadge value={r.status} /> },
    { label: "Started", value: <RelativeTime iso={r.startedAt} /> },
    {
      label: "Finished",
      value: r.completedAt ? <RelativeTime iso={r.completedAt} /> : <Dash />,
    },
    { label: "Duration", value: formatDuration(r.durationSec) },
    { label: "Processed", value: count(r.assetsProcessed) },
    { label: "Created", value: count(r.assetsCreated) },
    { label: "Updated", value: count(r.assetsUpdated) },
  ],
  edgeSuggestion: (s) => [
    {
      label: "Edge",
      value: (
        <span className="break-words">
          {s.from} → {s.to}
        </span>
      ),
      wide: true,
    },
    { label: "Kind", value: SUGGESTION_KIND_LABEL[s.kind] },
    {
      label: "Reason",
      value: <span className="break-words">{s.reason}</span>,
      wide: true,
    },
    { label: "Confidence", value: s.confidence },
    { label: "Score", value: s.score != null ? count(s.score) : <Dash /> },
    { label: "Status", value: text(s.status) },
    { label: "Created", value: s.createdAt ? <RelativeTime iso={s.createdAt} /> : <Dash /> },
  ],
  audit: (a) => [
    { label: "Actor", value: a.actor },
    { label: "Action", value: a.action },
    { label: "Entity", value: a.entityName },
    { label: "At", value: <RelativeTime iso={a.at} /> },
  ],
  generic: (g) => {
    const fields: SummaryField[] = []
    if (g.name) fields.push({ label: "Name", value: g.name })
    if (g.slug)
      fields.push({
        label: "Slug",
        value: <code className="font-mono text-xs">{g.slug}</code>,
      })
    if (g.createdAt)
      fields.push({ label: "Created", value: <RelativeTime iso={g.createdAt} /> })
    if (g.updatedAt)
      fields.push({ label: "Updated", value: <RelativeTime iso={g.updatedAt} /> })
    return fields
  },
}

/** Resolve curated summary fields for an entity kind + row (registry lookup). */
export function summaryFieldsFor<K extends SummaryKind>(
  kind: K,
  row: SummaryRowMap[K],
): SummaryField[] {
  return SUMMARY_FIELDS[kind](row)
}

/** `summary` prop shape: explicit fields, or a registry `{kind, row}` pair. */
export type TitleSummary =
  | SummaryField[]
  | { [K in SummaryKind]: { kind: K; row: SummaryRowMap[K] } }[SummaryKind]

export interface TitleWithSummaryProps {
  /**
   * The title cell content — usually a `Link`. The CELL owns the
   * max-width/truncate; this component keeps the inner title truncatable
   * (`block min-w-0`) and exposes the full name via `title` for the native
   * tooltip fallback.
   */
  title: React.ReactNode
  /**
   * Plain-text full title for the `title` attribute / accessible fallback.
   * Defaults to `title` when it is a plain string.
   */
  titleText?: string
  /** Curated fields — `summaryFieldsFor(kind, row)` output or `{kind, row}`. */
  summary?: TitleSummary
  /**
   * Set true when `title` contains no focusable element (plain text) so the
   * trigger becomes a tab stop and the card opens on keyboard focus. Leave
   * false for link titles — link focus already bubbles to the trigger.
   */
  focusable?: boolean
  /** Escape hatch: fully custom card body; wins over `summary`. */
  children?: React.ReactNode
  className?: string
}

function SummaryFields({ fields }: { fields: SummaryField[] }) {
  return (
    <dl className="flex flex-col gap-1.5 text-xs">
      {fields.map((f) => (
        <div
          key={f.label}
          className={cn("flex gap-3", f.wide ? "flex-col gap-0.5" : "items-baseline justify-between")}
        >
          <dt className="shrink-0 text-muted-foreground">{f.label}</dt>
          <dd className={cn("min-w-0", !f.wide && "text-right")}>{f.value ?? <Dash />}</dd>
        </div>
      ))}
    </dl>
  )
}

function resolveFields(summary: TitleSummary | undefined): SummaryField[] {
  if (!summary) return []
  if (Array.isArray(summary)) return summary
  // The {kind,row} union is discriminated at the call site; collapse to a
  // single signature here — each kind's extractor still receives its own
  // row shape at runtime.
  const extract = SUMMARY_FIELDS[summary.kind] as (
    row: SummaryRowMap[SummaryKind],
  ) => SummaryField[]
  return extract(summary.row)
}

/**
 * Title cell with a hover/focus summary card. Wraps `title` in a Radix
 * `HoverCard` trigger — opens on hover AND keyboard focus — and renders
 * the curated fields (or `children`) in a compact card. Renders the plain
 * title (with `title` tooltip fallback) when there is no summary content.
 */
export function TitleWithSummary({
  title,
  titleText,
  summary,
  focusable = false,
  children,
  className,
}: TitleWithSummaryProps) {
  const fields = resolveFields(summary)
  const hasSummary = children != null || fields.length > 0
  const label = titleText ?? (typeof title === "string" ? title : undefined)

  const trigger = (
    <span
      className={cn(
        "block min-w-0 rounded-sm",
        focusable &&
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      title={label}
      tabIndex={focusable ? 0 : undefined}
    >
      {title}
    </span>
  )

  if (!hasSummary) return trigger

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        {children ?? <SummaryFields fields={fields} />}
      </HoverCardContent>
    </HoverCard>
  )
}
