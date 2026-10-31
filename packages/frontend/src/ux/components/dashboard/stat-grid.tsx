import { flags } from "@/ux/lib/flags";
import { ArrowUpRightIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Card, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { formatNumber } from "@/ux/lib/format"
import { ux } from "@/ux/lib/paths"

export interface StatGridCounts {
  products: number
  components: number
  instances: number
  importers: number
}

export interface StatGridDeltas {
  products?: number | null
  components?: number | null
  instances?: number | null
}

/** Every stat is a link to the list it counts — numbers are navigation, not decoration. */
export function StatGrid({ counts, deltas }: { counts: StatGridCounts; deltas?: StatGridDeltas }) {
  const stats = [
    { key: "products", label: "Products", href: ux("/products"), delta: deltas?.products },
    { key: "components", label: "Components", href: ux("/components"), delta: deltas?.components },
    { key: "instances", label: "Instances", href: ux("/components"), delta: deltas?.instances },
    { key: "importers", label: "Active importers", href: ux("/importers"), delta: null },
  ] as const

  return (
    <section aria-label="Catalog totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((s) => (
        <Link key={s.key} to={s.href} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full transition-colors group-hover:border-primary/40">
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                {s.label}
                <ArrowUpRightIcon className="size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
              </CardDescription>
              <CardTitle className="tabular text-3xl font-semibold tracking-tight">{formatNumber(counts[s.key])}</CardTitle>
              <p className="tabular text-xs text-muted-foreground">
                {flags.statDeltas ? (s.delta == null ? "—" : <><span className="font-medium text-success">+{s.delta}</span> this week</>) : null}
              </p>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </section>
  )
}
