
import { Link } from "react-router-dom"
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { CriticalityBadge, ProductTypeBadge } from "@/ux/components/patterns/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { HEALTH_META, type InstanceStatus } from "@/ux/lib/domain"
import type { Criticality } from "@/ux/lib/domain"
import type { Product, ProductComponentRow } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"
import { cn } from "@/ux/lib/utils"

type Tone = "default" | "error"
type Edge = { id: string; from: string; to: string; tone: Tone; group?: string }
type DrawnEdge = Edge & { d: string }

const UNGROUPED = "Ungrouped"

const DOT: Record<InstanceStatus, string> = {
  RUNNING: "bg-success",
  STOPPED: "bg-warning",
  ERROR: "bg-destructive",
  GONE: "bg-muted-foreground",
}

function worstStatus(component: ProductComponentRow): InstanceStatus | null {
  return component.worstStatus
}

function StatusDot({ status }: { status: InstanceStatus | null }) {
  if (!status) return <span className="size-2 shrink-0 rounded-full border border-dashed border-muted-foreground" />
  return (
    <span className="inline-flex shrink-0">
      <span className={cn("size-2 rounded-full", DOT[status])} aria-hidden="true" />
      <span className="sr-only">{HEALTH_META[status].label}</span>
    </span>
  )
}

export function ProductMap({
  product,
  consumers,
  components,
}: {
  product: Product
  consumers: { id: string; name: string; slug: string; criticality?: Criticality | null }[]
  components: ProductComponentRow[]
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [drawn, setDrawn] = useState<DrawnEdge[]>([])

  const groups = useMemo(() => {
    const map = new Map<string, ProductComponentRow[]>()
    for (const c of components) {
      const key = c.componentGroupName ?? UNGROUPED
      map.set(key, [...(map.get(key) ?? []), c])
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)))
      .map(([name, items]) => ({ name, items }))
  }, [components])

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = consumers.map((p) => ({ id: `e-c-${p.id}`, from: `consumer:${p.id}`, to: "product", tone: "default" }))
    for (const g of groups) {
      const groupHasError = g.items.some((c) => worstStatus(c) === "ERROR")
      list.push({ id: `e-g-${g.name}`, from: "product", to: `group:${g.name}`, tone: groupHasError ? "error" : "default", group: g.name })
      for (const c of g.items) {
        list.push({
          id: `e-k-${c.id}`,
          from: `group:${g.name}`,
          to: `comp:${c.id}`,
          tone: worstStatus(c) === "ERROR" ? "error" : "default",
          group: g.name,
        })
      }
    }
    return list
  }, [consumers, groups])

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

  const dim = (group?: string) => focus !== null && group !== undefined && group !== focus

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product map</CardTitle>
        <CardDescription>
          Who depends on {product.name}, and what it is built from. Hover a group to trace its components.
        </CardDescription>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground" aria-label="Legend">
          {(["RUNNING", "STOPPED", "ERROR"] as const).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", DOT[s])} aria-hidden="true" />
              {HEALTH_META[s].label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-px w-4 bg-destructive" aria-hidden="true" />
            Path with a failing instance
          </li>
        </ul>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div
          ref={rootRef}
          className="relative isolate flex min-w-0 flex-col gap-8 py-2 lg:min-w-[860px] lg:flex-row lg:items-center lg:gap-8"
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
                  "transition-opacity",
                  e.tone === "error" ? "stroke-destructive" : "stroke-border",
                  dim(e.group) && "opacity-20",
                )}
              />
            ))}
          </svg>

          <div className="flex flex-col gap-2 lg:w-36 lg:shrink-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Consumed by</p>
            {consumers.length ? (
              consumers.map((p) => (
                <Link
                  key={p.id}
                  to={ux(`/products/${p.slug}`)}
                  data-node={`consumer:${p.id}`}
                  className="flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm transition-colors hover:bg-muted/60"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <CriticalityBadge value={p.criticality ?? null} />
                </Link>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No consumers yet</div>
            )}
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
                  <dd className="tabular text-sm font-medium">{components.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Groups</dt>
                  <dd className="tabular text-sm font-medium">{groups.length}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Composed of</p>
            {groups.length ? (
              groups.map((g) => (
                <div
                  key={g.name}
                  onMouseEnter={() => setFocus(g.name)}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus(g.name)}
                  onBlur={() => setFocus(null)}
                  className={cn(
                    "flex flex-col gap-3 transition-opacity lg:flex-row lg:items-center lg:gap-8",
                    dim(g.name) && "opacity-40",
                  )}
                >
                  <div
                    data-node={`group:${g.name}`}
                    className="flex items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm font-medium lg:w-36 lg:shrink-0"
                  >
                    <span className="truncate">{g.name}</span>
                    <span className="tabular text-xs text-muted-foreground">{g.items.length}</span>
                  </div>
                  <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {g.items.map((c) => (
                      <li key={c.id}>
                        <Link
                          to={ux(`/components/${c.slug}`)}
                          data-node={`comp:${c.id}`}
                          className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted/60"
                        >
                          {c.provider ? <ProviderMark provider={c.provider} size="sm" /> : null}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium">{c.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {[c.resourceType, c.instanceCount === null ? null : `${c.instanceCount} ${c.instanceCount === 1 ? "instance" : "instances"}`].filter(Boolean).join(" · ") || "—"}
                            </span>
                          </span>
                          <StatusDot status={worstStatus(c)} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No components are composed into this product yet
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
