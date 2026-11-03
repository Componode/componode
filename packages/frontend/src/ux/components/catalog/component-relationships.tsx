import { Link } from "react-router-dom"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { XIcon } from "lucide-react"
import type { ComponentRelationKind } from "@componode/core"
import { useComponentRelationships } from "@/api/hooks/components"
import { mapComponentRelationships } from "@/api/mappers/catalog"
import { ErrorState, ForbiddenState, TableSkeleton } from "@/ux/components/patterns/states"
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state"
import { CATEGORY_LABELS, PROVIDER_META } from "@/ux/lib/domain"
import { EnvironmentBadge, HealthBadge, LifecycleBadge, ProductTypeBadge } from "@/ux/components/patterns/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import type {
  ComponentDependentNode,
  ComponentRelationshipsView,
  GroupMediatedDependentNode,
  RelatedComponentNode,
} from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"
import { cn } from "@/ux/lib/utils"

/**
 * Spec 060 / ADR-128 — read-only one-hop Component relationships. Typed lanes
 * preserve each stored relation's source/target direction; ComponentInstances
 * nest under the focused Component as operational children, never peer nodes.
 */

type LaneKey =
  | "dependedOnBy"
  | "sourcedBy"
  | "exposedBy"
  | "productDependents"
  | "dependsOn"
  | "sourcesFrom"
  | "exposes"

/** A Product dependent rendered once per Product — provenance paths
 *  (direct edge, group-mediated) are labeled, never separate nodes. */
type ProductDependent = ComponentDependentNode & {
  direct: boolean
  viaGroup?: GroupMediatedDependentNode["viaGroup"]
}

type RelationNode =
  | { kind: "component"; key: string; data: RelatedComponentNode; relation: string; lane: LaneKey }
  | { kind: "product"; key: string; data: ProductDependent; relation: string; lane: LaneKey }

type Edge = { id: string; from: string; to: string }
type DrawnEdge = Edge & { d: string }

const LANE_LIMIT = 4

const LANE_META: Record<LaneKey, { title: string; incoming: boolean; hint: (c: string) => string }> = {
  dependedOnBy: { title: "Depended on by", incoming: true, hint: (c) => `dependents → ${c}` },
  sourcedBy: { title: "Sourced by", incoming: true, hint: (c) => `sourcing services → ${c}` },
  exposedBy: { title: "Exposed by", incoming: true, hint: (c) => `exposing services → ${c}` },
  productDependents: { title: "Product dependents", incoming: true, hint: (c) => `products → ${c}` },
  dependsOn: { title: "Depends on", incoming: false, hint: (c) => `${c} → targets` },
  sourcesFrom: { title: "Sources from", incoming: false, hint: (c) => `${c} → repositories` },
  exposes: { title: "Exposes", incoming: false, hint: (c) => `${c} → APIs` },
}

/** Query-owning wrapper: mounts inside the Relationships TabsContent so the
 *  bounded read fires when the tab opens and owns its own loading/error
 *  states (spec 060 T024). */
export function ComponentRelationshipsPanel({ componentId }: { componentId: string }) {
  const [includeGone, setIncludeGone] = useState(false)
  const query = useComponentRelationships(componentId, { includeGone })

  if (query.isPending) {
    return (
      <Card className="py-0">
        <TableSkeleton rows={5} columns={3} />
      </Card>
    )
  }

  if (query.error) {
    if (isForbidden(query.error)) return <ForbiddenState />
    if (isNotFound(query.error)) {
      return (
        <Alert>
          <AlertTitle>Component not found</AlertTitle>
          <AlertDescription>The relationship read returned no component.</AlertDescription>
        </Alert>
      )
    }
    return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
  }

  if (!query.data) return null
  return (
    <ComponentRelationships
      view={mapComponentRelationships(query.data)}
      includeGone={includeGone}
      onToggleGone={setIncludeGone}
    />
  )
}

const UNAVAILABLE_LABELS: Record<ComponentRelationKind, string> = {
  dependedOnBy: LANE_META.dependedOnBy.title,
  sourcedBy: LANE_META.sourcedBy.title,
  exposedBy: LANE_META.exposedBy.title,
  dependsOn: LANE_META.dependsOn.title,
  sourcesFrom: LANE_META.sourcesFrom.title,
  exposes: LANE_META.exposes.title,
  productDependents: "Product dependents",
  instances: "Instances",
}

export function ComponentRelationships({
  view,
  includeGone = false,
  onToggleGone,
}: {
  view: ComponentRelationshipsView
  includeGone?: boolean
  onToggleGone?: (value: boolean) => void
}) {
  const component = view.component
  const rootRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Partial<Record<LaneKey, boolean>>>({})
  const [announcement, setAnnouncement] = useState("")
  const [drawn, setDrawn] = useState<DrawnEdge[]>([])

  const lanes = useMemo<Record<LaneKey, RelationNode[]>>(() => {
    const componentNodes = (
      key: LaneKey,
      nodes: RelatedComponentNode[],
      relation: (n: RelatedComponentNode) => string,
    ): RelationNode[] =>
      nodes.map((n) => ({
        kind: "component" as const,
        key: `${key}:${n.id}`,
        data: n,
        relation: relation(n),
        lane: key,
      }))
    const products = new Map<string, ProductDependent>()
    for (const p of view.productDependents.direct) {
      products.set(p.id, { ...p, direct: true })
    }
    for (const p of view.productDependents.viaGroups) {
      const existing = products.get(p.id)
      products.set(p.id, {
        ...(existing ?? p),
        direct: existing?.direct ?? false,
        viaGroup: p.viaGroup,
      })
    }
    return {
      dependedOnBy: componentNodes("dependedOnBy", view.dependedOnBy, () => `depends on ${component.name}`),
      sourcedBy: componentNodes("sourcedBy", view.sourcedBy, () => `sources from ${component.name}`),
      exposedBy: componentNodes("exposedBy", view.exposedBy, () => `exposes ${component.name}`),
      productDependents: [...products.values()].map((p) => ({
        kind: "product" as const,
        key: `productDependents:${p.id}`,
        data: p,
        relation: `depends on ${component.name}${[
          p.direct ? "directly" : null,
          p.viaGroup ? `via ${p.viaGroup.name}` : null,
        ]
          .filter(Boolean)
          .map((s) => ` ${s}`)
          .join(" and")}`,
        lane: "productDependents" as LaneKey,
      })),
      dependsOn: componentNodes("dependsOn", view.dependsOn, () => `depended on by ${component.name}`),
      sourcesFrom: componentNodes("sourcesFrom", view.sourcesFrom, () => `sourced by ${component.name}`),
      exposes: componentNodes("exposes", view.exposes, () => `exposed by ${component.name}`),
    }
  }, [view, component.name])

  const allNodes = useMemo(() => {
    const map = new Map<string, RelationNode>()
    for (const nodes of Object.values(lanes)) for (const n of nodes) map.set(n.key, n)
    return map
  }, [lanes])

  const totalNodes = useMemo(
    () => Object.values(lanes).reduce((n, nodes) => n + nodes.length, 0),
    [lanes],
  )

  const visibleKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const [key, nodes] of Object.entries(lanes) as [LaneKey, RelationNode[]][]) {
      const limit = expanded[key] ? nodes.length : LANE_LIMIT
      for (const n of nodes.slice(0, limit)) keys.add(n.key)
    }
    return keys
  }, [lanes, expanded])

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = []
    for (const n of allNodes.values()) {
      if (!visibleKeys.has(n.key)) continue
      const incoming = LANE_META[n.lane].incoming
      list.push(
        incoming
          ? { id: `e-${n.key}`, from: n.key, to: "component" }
          : { id: `e-${n.key}`, from: "component", to: n.key },
      )
    }
    return list
  }, [allNodes, visibleKeys])

  const measure = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const base = root.getBoundingClientRect()
    const anchor = (id: string, side: "left" | "right") => {
      const el = root.querySelector(`[data-node="${id}"]`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: (side === "right" ? r.right : r.left) - base.left, y: r.top + r.height / 2 - base.top }
    }
    const next: DrawnEdge[] = []
    for (const e of edges) {
      // Source exits its right side; target enters its left side. Edge paths
      // always run source → target so the arrowhead marks the real target.
      const a = anchor(e.from, "right")
      const b = anchor(e.to, "left")
      if (!a || !b) continue
      const mx = (a.x + b.x) / 2
      next.push({ ...e, d: `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}` })
    }
    setDrawn(next)
  }, [edges])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [measure])

  // Reset view-only state when navigating between components.
  useEffect(() => {
    setSelected(null)
    setExpanded({})
    setAnnouncement("")
  }, [component.id])

  const selectNode = useCallback((n: RelationNode) => {
    setSelected(n.key)
    setAnnouncement(`${n.data.name} selected — ${n.relation}`)
  }, [])

  const clear = useCallback(() => {
    setSelected(null)
    setAnnouncement("Selection cleared")
  }, [])

  const onCanvasKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") clear()
  }

  const selectedNode = selected ? allNodes.get(selected) : undefined

  const nodeButton = (n: RelationNode) => {
    const retired = n.data.lifecycle === "RETIRED"
    const label = `${n.data.name}, ${n.relation}${retired ? ", Retired" : ""}`
    const isSelected = selected === n.key
    return (
      <button
        key={n.key}
        type="button"
        data-node={n.key}
        aria-label={label}
        aria-pressed={isSelected}
        onClick={() => selectNode(n)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            selectNode(n)
          }
        }}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left text-sm",
          "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "motion-safe:transition-colors",
          isSelected && "border-primary ring-2 ring-ring",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{n.data.name}</span>
          {n.kind === "product" && n.data.viaGroup && (
            <span className="truncate text-xs text-muted-foreground">
              via {n.data.viaGroup.name}
            </span>
          )}
          {retired && <span className="text-xs text-muted-foreground">Retired</span>}
        </span>
      </button>
    )
  }

  const laneColumn = (key: LaneKey) => {
    const meta = LANE_META[key]
    const nodes = lanes[key]
    const limit = expanded[key] ? nodes.length : LANE_LIMIT
    const visible = nodes.slice(0, limit)
    const overflow = nodes.length - visible.length
    return (
      <div key={key} className="flex flex-col gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{meta.title}</p>
          <p className="text-xs text-muted-foreground/80">{meta.hint(component.name)}</p>
        </div>
        {nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">None</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visible.map(nodeButton)}
            {overflow > 0 && (
              <button
                type="button"
                aria-label={`+${overflow} more ${meta.title}`}
                className="rounded-lg border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors"
                onClick={() => setExpanded((prev) => ({ ...prev, [key]: true }))}
              >
                +{overflow} more
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const empty =
    totalNodes === 0 && view.instances.length === 0

  return (
    <Card onKeyDown={onCanvasKeyDown}>
      <CardHeader>
        <CardTitle>Component relationships</CardTitle>
        <CardDescription>
          One-hop relations around {component.name} — typed Component edges,
          Product dependencies, and operational instances. Read-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.unavailableKinds.length > 0 && (
          <Alert>
            <AlertTitle>Some relations couldn't be loaded</AlertTitle>
            <AlertDescription>
              {view.unavailableKinds.map((g) => UNAVAILABLE_LABELS[g as ComponentRelationKind] ?? g).join(", ")} — the view may be incomplete.
            </AlertDescription>
          </Alert>
        )}

        <div aria-live="polite" role="status" className="sr-only">
          {announcement}
        </div>

        {empty && (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground/80">No relationships yet</p>
            {view.unavailableKinds.length > 0 ? (
              <p>Some relation groups could not be loaded — the view may be incomplete.</p>
            ) : (
              <p>
                No stored Component relations, Product dependencies, or active
                instances — nothing is inferred from names or importer metadata.
              </p>
            )}
          </div>
        )}

        {
          <div
            ref={rootRef}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("button, a")) clear()
            }}
            className="relative isolate flex min-w-0 flex-col gap-6 py-2 lg:flex-row lg:items-center lg:gap-8"
          >
            <svg className="pointer-events-none absolute inset-0 -z-10 hidden size-full lg:block" aria-hidden="true">
              <defs>
                <marker id="cr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-border" />
                </marker>
              </defs>
              {drawn.map((e) => (
                <path
                  key={e.id}
                  d={e.d}
                  fill="none"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  markerEnd="url(#cr-arrow)"
                  className={cn(
                    "stroke-border",
                    selected !== null && e.from !== selected && e.to !== selected && "opacity-20",
                  )}
                />
              ))}
            </svg>

            <div className="flex flex-col gap-5 lg:w-52 lg:shrink-0">
              {laneColumn("dependedOnBy")}
              {laneColumn("sourcedBy")}
              {laneColumn("exposedBy")}
              {laneColumn("productDependents")}
            </div>

            <div className="lg:w-56 lg:shrink-0">
              <div data-node="component" className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-0.5">
                  <span className="text-base font-semibold text-balance">{component.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{component.slug}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{CATEGORY_LABELS[component.category] ?? component.category}</Badge>
                  <Badge variant="outline">{PROVIDER_META[component.provider].label}</Badge>
                  {component.lifecycle === "RETIRED" && <LifecycleBadge value="RETIRED" />}
                </div>
                <div className="border-t pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Instances</p>
                    {onToggleGone && (
                      <button
                        type="button"
                        aria-pressed={includeGone}
                        className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded motion-safe:transition-colors"
                        onClick={() => onToggleGone(!includeGone)}
                      >
                        {includeGone ? "Hide gone" : "Show gone"}
                      </button>
                    )}
                  </div>
                  {view.instances.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No active instances</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {view.instances.map((i) => (
                        <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
                          <EnvironmentBadge value={i.environment} />
                          <HealthBadge value={i.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-5">
              {laneColumn("dependsOn")}
              {laneColumn("sourcesFrom")}
              {laneColumn("exposes")}
            </div>
          </div>
        }

        {selectedNode && (
          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{selectedNode.data.name}</span>
                {selectedNode.kind === "component" && (
                  <Badge variant="secondary">
                    {CATEGORY_LABELS[selectedNode.data.category] ?? selectedNode.data.category}
                  </Badge>
                )}
                {selectedNode.kind !== "component" && <ProductTypeBadge value={selectedNode.data.type} />}
                {selectedNode.data.lifecycle === "RETIRED" && <LifecycleBadge value="RETIRED" />}
              </div>
              <p className="text-sm text-muted-foreground">{selectedNode.relation}</p>
              {selectedNode.kind === "product" && (
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  {selectedNode.data.direct && (
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">Path</dt>
                      <dd className="font-medium">Direct</dd>
                    </div>
                  )}
                  {selectedNode.data.viaGroup && (
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">Via group</dt>
                      <dd>
                        <Link
                          to={ux(`/component-groups/${selectedNode.data.viaGroup.slug}`)}
                          className="font-medium text-primary hover:underline"
                        >
                          {selectedNode.data.viaGroup.name}
                        </Link>
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link
                  to={
                    selectedNode.kind === "component"
                      ? ux(`/components/${selectedNode.data.slug}`)
                      : ux(`/products/${selectedNode.data.slug}`)
                  }
                >
                  Open {selectedNode.kind === "component" ? "component" : "product"}
                </Link>
              </Button>
              <Button variant="ghost" size="icon" aria-label="Close selection" onClick={clear}>
                <XIcon data-icon="inline-start" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
