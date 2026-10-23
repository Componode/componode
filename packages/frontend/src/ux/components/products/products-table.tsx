
import { PackageIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { CompletenessIndicator } from "@/ux/components/patterns/completeness"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { EmptyState } from "@/ux/components/patterns/states"
import { CriticalityBadge, HealthBadge, LifecycleBadge, ProductTypeBadge } from "@/ux/components/patterns/status-badge"
import { Button } from "@/ux/components/ui/button"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { CRITICALITY_META, LIFECYCLE_META, PRODUCT_TYPE_META } from "@/ux/lib/domain"
import type { Product } from "@/ux/lib/view-types"

const toOptions = (meta: Record<string, { label: string }>) => Object.entries(meta).map(([value, m]) => ({ value, label: m.label }))

export function ProductsTable({ data }: { data: Product[] }) {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")
  const [type, setType] = React.useState("all")
  const [criticality, setCriticality] = React.useState("all")
  const [lifecycle, setLifecycle] = React.useState("ACTIVE")

  const rows = data.filter(
    (p) =>
      (type === "all" || p.type === type) &&
      (criticality === "all" || p.criticality === criticality) &&
      (lifecycle === "all" || p.lifecycle === lifecycle) &&
      (query === "" || `${p.name} ${p.teamOwnerName ?? ""} ${p.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search products, teams, tags"
        resultCount={rows.length}
        total={data.length}
        filters={[
          { id: "type", label: "Type", value: type, onChange: setType, options: toOptions(PRODUCT_TYPE_META) },
          { id: "crit", label: "Criticality", value: criticality, onChange: setCriticality, options: toOptions(CRITICALITY_META) },
          { id: "life", label: "Lifecycle", value: lifecycle, onChange: setLifecycle, options: toOptions(LIFECYCLE_META) },
        ]}
      />
      <Card className="overflow-hidden py-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={PackageIcon}
            title="No products match"
            description="Try a different search or clear the filters."
            className="border-0"
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("")
                  setType("all")
                  setCriticality("all")
                  setLifecycle("all")
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Criticality</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="text-right">Components</TableHead>
                <TableHead>Completeness</TableHead>
                <TableHead className="pr-4 text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button")) return
                    navigate(`/products/${p.slug}`)
                  }}
                >
                  <TableCell className="pl-4">
                    <div className="flex flex-col">
                      <Link to={`/products/${p.slug}`} className="font-medium underline-offset-4 hover:underline">
                        {p.name}
                      </Link>
                      <span className="max-w-72 truncate text-xs text-muted-foreground">{p.description ?? "No description"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ProductTypeBadge value={p.type} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      <span>{p.teamOwnerName ?? <span className="text-muted-foreground">Unowned</span>}</span>
                      <span className="text-xs text-muted-foreground">{p.lobOwnerName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <CriticalityBadge value={p.criticality} />
                  </TableCell>
                  <TableCell>
                    {p.lifecycle === "RETIRED" ? <LifecycleBadge value="RETIRED" /> : <HealthBadge value={p.status} />}
                  </TableCell>
                  <TableCell className="tabular text-right">{p.componentCount}</TableCell>
                  <TableCell>
                    <CompletenessIndicator value={p.completeness} />
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-muted-foreground">
                    <RelativeTime iso={p.updatedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
