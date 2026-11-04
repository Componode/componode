
import { Link } from "react-router-dom"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { XIcon } from "lucide-react"
import { CriticalityBadge, HealthBadge, LifecycleBadge, ProductTypeBadge, TONE_DOT } from "@/ux/components/patterns/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { CATEGORY_LABELS, HEALTH_META } from "@/ux/lib/domain"
import type { InstanceStatus } from "@/ux/lib/domain"
import type { Product, ProductTopology, RelatedProduct, TopologyComponent, TopologyGroup } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"
import { cn } from "@/ux/lib/utils"

/**
 * Spec 059/062 / ADR-127 — read-only one-hop topology on the dedicated
 * Product Map tab. Lanes preserve each relation's actual source/target
 * direction; pan/zoom/drag and edge authoring stay out of scope.
 * Spec 061 / ADR-127 Amendment 2 — direct DEPENDS_ON Component targets render
 * as typed nodes in their own outgoing lane.
 */

type LaneKey = "composedBy" | "consumedBy" | "composes" | "consumesFrom" | "dependsOnComponents" | "dependsOnGroups"

type TopologyNode =
  | { kind: "product"; key: string; data: RelatedProduct; relation: string; lane: LaneKey }
  | { kind: "group"; key: string; data: TopologyGroup; relation: string; lane: LaneKey }
  | { kind: "component"; key: string; data: TopologyComponent; relation: string; lane: LaneKey }

type Edge = { id: string; from: string; to: string; tone: "default" | "error" }
type DrawnEdge = Edge & { d: string }

const LANE_LIMIT = 4

const LANE_META: Record<LaneKey, { title: string; incoming: boolean; hint: (p: string) => string }> = {
  composedBy: { title: "Composed by", incoming: true, hint: (p) => `parents → ${p}` },
  consumedBy: { title: "Consumed by", incoming: true, hint: (p) => `consumers → ${p}` },
  composes: { title: "Composes", incoming: false, hint: (p) => `${p} → children` },
  consumesFrom: { title: "Consumes from", incoming: false, hint: (p) => `${p} → platforms` },
  dependsOnComponents: { title: "Depends on components", incoming: false, hint: (p) => `${p} → components` },
  dependsOnGroups: { title: "Depends on groups", incoming: false, hint: (p) => `${p} → groups` },
}

const UNAVAILABLE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(LANE_META).map(([k, v]) => [k, v.title]),
)

function nodeStatus(n: TopologyNode): InstanceStatus | null {
  if (n.kind === "product") return n.data.status
  if (n.kind === "component") return n.data.worstStatus
  return null
}

function StatusDot({ status }: { status: InstanceStatus | null }) {
  if (!status) {
    return <span className="size-2 shrink-0 rounded-full border border-dashed border-muted-foreground" aria-hidden="true" />
  }
  return (
    <span className="inline-flex shrink-0">
      <span className={cn("size-2 rounded-full", TONE_DOT[HEALTH_META[status].tone])} aria-hidden="true" />
      <span className="sr-only">{HEALTH_META[status].label}</span>
    </span>
  )
}

export function ProductMap({ product, topology }: { product: Product; topology: ProductTopology }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Partial<Record<LaneKey, boolean>>>({})
  const [announcement, setAnnouncement] = useState("")
  const [drawn, setDrawn] = useState<DrawnEdge[]>([])

  const lanes = useMemo(() => {
    const productNodes = (key: LaneKey, relation: (n: RelatedProduct) => string): TopologyNode[] =>
      (topology[key] as RelatedProduct[]).map((p) => ({
        kind: "product" as const,
        key: `${key}:${p.id}`,
        data: p,
        relation: relation(p),
        lane: key,
      }))
    return {
      composedBy: productNodes("composedBy", () => `composes ${product.name}`),
      consumedBy: productNodes("consumedBy", () => `consumes from ${product.name}`),
      composes: productNodes("composes", () => `composed by ${product.name}`),
      consumesFrom: productNodes("consumesFrom", () => `platform consumed by ${product.name}`),
      dependsOnComponents: topology.dependsOnComponents.map((c) => ({
        kind: "component" as const,
        key: `dependsOnComponents:${c.id}`,
        data: c,
        relation: `${product.name} depends on`,
        lane: "dependsOnComponents" as LaneKey,
      })),
      dependsOnGroups: topology.dependsOnGroups.map((g) => ({
        kind: "group" as const,
        key: `dependsOnGroups:${g.id}`,
        data: g,
        relation: `${product.name} depends on`,
        lane: "dependsOnGroups" as LaneKey,
      })),
    }
  }, [topology, product.name])

  const allNodes = useMemo(() => {
    const map = new Map<string, TopologyNode>()
    for (const nodes of Object.values(lanes)) for (const n of nodes) map.set(n.key, n)
    return map
  }, [lanes])

  const totalNodes = useMemo(
    () => Object.values(lanes).reduce((n, nodes) => n + nodes.length, 0),
    [lanes],
  )

  const visibleKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const [key, nodes] of Object.entries(lanes) as [LaneKey, TopologyNode[]][]) {
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
      const tone = nodeStatus(n) === "ERROR" ? "error" as const : "default" as const
      list.push(
        incoming
          ? { id: `e-${n.key}`, from: n.key, to: "product", tone }
          : { id: `e-${n.key}`, from: "product", to: n.key, tone },
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
      // always run source → target so the curve ends on the real target.
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

  // Reset view-only state when navigating between products.
  useEffect(() => {
    setSelected(null)
    setExpanded({})
    setAnnouncement("")
  }, [product.id])

  const selectNode = useCallback(
    (n: TopologyNode) => {
      setSelected(n.key)
      setAnnouncement(`${n.data.name} selected — ${n.relation}`)
    },
    [],
  )

  const clear = useCallback(() => {
    setSelected(null)
    setAnnouncement("Selection cleared")
  }, [])

  const onCanvasKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") clear()
  }

  const selectedNode = selected ? allNodes.get(selected) : undefined

  const nodeButton = (n: TopologyNode) => {
    const status = nodeStatus(n)
    const retired = n.data.lifecycle === "RETIRED"
    const statusText = retired
      ? ", retired"
      : n.kind !== "group"
        ? status
          ? `, ${HEALTH_META[status].label}`
          : ", no health data"
        : ""
    const label = `${n.data.name}, ${n.relation}${statusText}`
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
          {n.kind === "group" && (
            <span className="truncate text-xs text-muted-foreground">
              Component group · {n.data.memberCount} {n.data.memberCount === 1 ? "member" : "members"}
            </span>
          )}
          {n.kind === "component" && (
            <span className="truncate text-xs text-muted-foreground">
              {CATEGORY_LABELS[n.data.category] ?? n.data.category}
            </span>
          )}
          {retired && <span className="text-xs text-muted-foreground">Retired</span>}
        </span>
        {retired ? null : <StatusDot status={status} />}
      </button>
    )
  }

  // Lanes render only for relation families that have data — except families
  // the backend could not load, whose header stays so the alert has context.
  const laneVisible = (key: LaneKey) =>
    lanes[key].length > 0 || topology.unavailableGroups.includes(key)

  const laneColumn = (key: LaneKey) => {
    const meta = LANE_META[key]
    const nodes = lanes[key]
    if (!laneVisible(key)) return null
    const limit = expanded[key] ? nodes.length : LANE_LIMIT
    const visible = nodes.slice(0, limit)
    const overflow = nodes.length - visible.length
    return (
      <div key={key} className="flex flex-col gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{meta.title}</p>
          <p className="text-xs text-muted-foreground/80">{meta.hint(product.name)}</p>
        </div>
        {nodes.length > 0 && (
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

  const incomingLanes: LaneKey[] = ["composedBy", "consumedBy"]
  const outgoingLanes: LaneKey[] = ["composes", "consumesFrom", "dependsOnComponents", "dependsOnGroups"]

  return (
    <Card onKeyDown={onCanvasKeyDown}>
      <CardHeader>
        <CardTitle>Product topology</CardTitle>
        <CardDescription>
          One-hop relations around {product.name} — the products that compose or consume it, and the components and groups it depends on.
        </CardDescription>
        {totalNodes > 0 && (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground" aria-label="Legend">
            {(["RUNNING", "STOPPED", "ERROR"] as const).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", TONE_DOT[HEALTH_META[s].tone])} aria-hidden="true" />
                {HEALTH_META[s].label}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-destructive" aria-hidden="true" />
              Path with a failing instance
            </li>
          </ul>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {topology.unavailableGroups.length > 0 && (
          <Alert>
            <AlertTitle>Some relations couldn't be loaded</AlertTitle>
            <AlertDescription>
              {topology.unavailableGroups.map((g) => UNAVAILABLE_LABELS[g] ?? g).join(", ")} — the map may be incomplete.
            </AlertDescription>
          </Alert>
        )}

        <div aria-live="polite" role="status" className="sr-only">
          {announcement}
        </div>

        {totalNodes === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground/80">No relationships yet</p>
            {topology.unavailableGroups.length > 0 ? (
              <p>Some relation families could not be loaded — the map may be incomplete.</p>
            ) : (
              <p>This product has no composition, consumption, component, or group relations yet. Add edges on Dependencies.</p>
            )}
          </div>
        ) : (
          <div
            ref={rootRef}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("button, a")) clear()
            }}
            className="relative isolate flex min-w-0 flex-col gap-6 py-2 lg:flex-row lg:items-center lg:gap-8"
          >
            <svg className="pointer-events-none absolute inset-0 -z-10 hidden size-full lg:block" aria-hidden="true">
              {drawn.map((e) => (
                <path
                  key={e.id}
                  d={e.d}
                  fill="none"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  className={cn(
                    e.tone === "error" ? "stroke-destructive" : "stroke-border",
                    selected !== null && e.from !== selected && e.to !== selected && "opacity-20",
                  )}
                />
              ))}
            </svg>

            {incomingLanes.some(laneVisible) && (
              <div className="flex flex-col gap-5 lg:w-44 lg:shrink-0">
                {incomingLanes.map(laneColumn)}
              </div>
            )}

            <div className="lg:w-48 lg:shrink-0">
              <div data-node="product" className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-0.5">
                  <span className="text-base font-semibold text-balance">{product.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{product.slug}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ProductTypeBadge value={product.type} />
                  <CriticalityBadge value={product.criticality} />
                </div>
                <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Components</dt>
                    <dd className="tabular text-sm font-medium">{product.componentCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Relations</dt>
                    <dd className="tabular text-sm font-medium">{totalNodes}</dd>
                  </div>
                </dl>
              </div>
            </div>

            {outgoingLanes.some(laneVisible) && (
              <div className="flex min-w-0 flex-1 flex-col gap-5">
                {outgoingLanes.map(laneColumn)}
              </div>
            )}
          </div>
        )}

        {selectedNode && (
          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{selectedNode.data.name}</span>
                {selectedNode.kind === "product" && <ProductTypeBadge value={selectedNode.data.type} />}
                {selectedNode.kind === "product" && <CriticalityBadge value={selectedNode.data.criticality} />}
                {selectedNode.kind === "component" && (
                  <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">Component</span>
                )}
                {selectedNode.kind !== "group" && selectedNode.data.lifecycle === "RETIRED" && (
                  <LifecycleBadge value="RETIRED" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">{selectedNode.relation}</p>
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                {selectedNode.kind === "product" && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">Health</dt>
                      <dd>
                        {selectedNode.data.status ? (
                          <HealthBadge value={selectedNode.data.status} />
                        ) : (
                          <span className="text-muted-foreground">No health data</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">Components</dt>
                      <dd className="tabular font-medium">
                        {selectedNode.data.componentCount} {selectedNode.data.componentCount === 1 ? "component" : "components"}
                      </dd>
                    </div>
                  </>
                )}
                {selectedNode.kind === "group" && (
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted-foreground">Members</dt>
                    <dd className="tabular font-medium">{selectedNode.data.memberCount}</dd>
                  </div>
                )}
                {selectedNode.kind === "component" && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">Status</dt>
                      <dd>
                        {selectedNode.data.lifecycle === "RETIRED" ? (
                          <span className="text-muted-foreground">Retired</span>
                        ) : selectedNode.data.worstStatus ? (
                          <HealthBadge value={selectedNode.data.worstStatus} />
                        ) : (
                          <span className="text-muted-foreground">No health data</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">Category</dt>
                      <dd className="font-medium">
                        {CATEGORY_LABELS[selectedNode.data.category] ?? selectedNode.data.category}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link
                  to={
                    selectedNode.kind === "product"
                      ? ux(`/products/${selectedNode.data.slug}`)
                      : selectedNode.kind === "component"
                        ? ux(`/components/${selectedNode.data.slug}`)
                        : ux(`/component-groups/${selectedNode.data.slug}`)
                  }
                >
                  Open {selectedNode.kind === "product" ? "product" : selectedNode.kind === "component" ? "component" : "group"}
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
