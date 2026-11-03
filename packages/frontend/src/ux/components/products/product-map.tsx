
import { Link } from "react-router-dom"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { XIcon } from "lucide-react"
import { CriticalityBadge, HealthBadge, LifecycleBadge, ProductTypeBadge, TONE_DOT } from "@/ux/components/patterns/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { HEALTH_META } from "@/ux/lib/domain"
import type { HealthStatus } from "@/ux/lib/domain"
import type { Product, ProductTopology, RelatedProduct, TopologyGroup } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"
import { cn } from "@/ux/lib/utils"

/**
 * Spec 059 / ADR-127 — read-only one-hop topology at the top of the
 * Dependencies tab. Lanes preserve each relation's actual source/target
 * direction; pan/zoom/drag and edge authoring stay out of scope.
 */

type LaneKey = "composedBy" | "consumedBy" | "composes" | "consumesFrom" | "dependsOnGroups"

type TopologyNode =
  | { kind: "product"; key: string; data: RelatedProduct; relation: string; lane: LaneKey }
  | { kind: "group"; key: string; data: TopologyGroup; relation: string; lane: LaneKey }

type Edge = { id: string; from: string; to: string }
type DrawnEdge = Edge & { d: string }

const LANE_LIMIT = 4

const LANE_META: Record<LaneKey, { title: string; incoming: boolean; hint: (p: string) => string }> = {
  composedBy: { title: "Composed by", incoming: true, hint: (p) => `parents → ${p}` },
  consumedBy: { title: "Consumed by", incoming: true, hint: (p) => `consumers → ${p}` },
  composes: { title: "Composes", incoming: false, hint: (p) => `${p} → children` },
  consumesFrom: { title: "Consumes from", incoming: false, hint: (p) => `${p} → platforms` },
  dependsOnGroups: { title: "Depends on groups", incoming: false, hint: (p) => `${p} → groups` },
}

const UNAVAILABLE_LABELS: Record<string, string> = {
  composedBy: "Composed by",
  composes: "Composes",
  consumesFrom: "Consumes from",
  consumedBy: "Consumed by",
  dependsOnGroups: "Depends on groups",
}

function nodeStatus(n: TopologyNode): HealthStatus | null {
  return n.kind === "product" ? n.data.status : null
}

function StatusDot({ status }: { status: HealthStatus | null }) {
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
      consumesFrom: productNodes("consumesFrom", () => `platform ${product.name} consumes from`),
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
      list.push(
        incoming
          ? { id: `e-${n.key}`, from: n.key, to: "product" }
          : { id: `e-${n.key}`, from: "product", to: n.key },
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
    const statusText = n.kind === "product" ? (status ? `, ${HEALTH_META[status].label}` : ", no health data") : ""
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
          {n.kind === "product" && n.data.lifecycle === "RETIRED" && (
            <span className="text-xs text-muted-foreground">Retired</span>
          )}
        </span>
        {n.kind === "product" && n.data.lifecycle === "RETIRED" ? null : <StatusDot status={status} />}
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
          <p className="text-xs text-muted-foreground/80">{meta.hint(product.name)}</p>
        </div>
        {nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">None</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visible.map(nodeButton)}
            {overflow > 0 && (
              <button
                type="button"
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product topology</CardTitle>
        <CardDescription>
          One-hop relations around {product.name} — who composes and consumes it, and what it depends on.
        </CardDescription>
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
            <p>This product composes, consumes, or depends on nothing. Author edges below.</p>
          </div>
        ) : (
          <div
            ref={rootRef}
            onKeyDown={onCanvasKeyDown}
            onClick={(e) => {
              if (e.target === e.currentTarget) clear()
            }}
            className="relative isolate flex min-w-0 flex-col gap-6 py-2 lg:flex-row lg:items-center lg:gap-8"
          >
            <svg className="pointer-events-none absolute inset-0 -z-10 hidden size-full lg:block" aria-hidden="true">
              <defs>
                <marker id="pm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
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
                  markerEnd="url(#pm-arrow)"
                  className={cn(
                    "stroke-border",
                    selected !== null && e.from !== selected && e.to !== selected && "opacity-20",
                  )}
                />
              ))}
            </svg>

            <div className="flex flex-col gap-5 lg:w-44 lg:shrink-0">
              {laneColumn("composedBy")}
              {laneColumn("consumedBy")}
            </div>

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

            <div className="flex min-w-0 flex-1 flex-col gap-5">
              {laneColumn("composes")}
              {laneColumn("consumesFrom")}
              {laneColumn("dependsOnGroups")}
            </div>
          </div>
        )}

        {selectedNode && (
          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{selectedNode.data.name}</span>
                {selectedNode.kind === "product" && <ProductTypeBadge value={selectedNode.data.type} />}
                {selectedNode.kind === "product" && <CriticalityBadge value={selectedNode.data.criticality} />}
                {selectedNode.kind === "product" && selectedNode.data.lifecycle === "RETIRED" && (
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
              </dl>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link
                  to={
                    selectedNode.kind === "product"
                      ? ux(`/products/${selectedNode.data.slug}`)
                      : ux(`/component-groups/${selectedNode.data.slug}`)
                  }
                >
                  Open {selectedNode.kind === "product" ? "product" : "group"}
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
