import { Link } from "react-router-dom"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Progress } from "@/ux/components/ui/progress"
import { ux } from "@/ux/lib/paths"

const FACETS = [
  { key: "owner", label: "Has an owner" },
  { key: "description", label: "Has a description" },
  { key: "dependencies", label: "Dependencies mapped" },
] as const

export interface CoverageFacets {
  owner: number | null
  description: number | null
  dependencies: number | null
}

/** Spec 023: show each facet separately. Never merge into a single "quality score". */
export function CoverageCard({
  coverage,
  componentsWithBom,
}: {
  coverage: CoverageFacets
  /** Spec 073 FR-026: BOM coverage line — passed only under `componentBom`. */
  componentsWithBom?: { withBom: number; active: number }
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Catalog completeness</CardTitle>
        <CardDescription>Share of active products meeting each facet.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {FACETS.map((f) => {
          const value = coverage[f.key]
          return (
            <div key={f.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span>{f.label}</span>
                <span className="tabular font-medium">{value === null ? "—" : `${value}%`}</span>
              </div>
              <Progress value={value ?? 0} aria-label={f.label} />
            </div>
          )
        })}
        {componentsWithBom ? (
          <p className="border-t pt-3 text-sm text-muted-foreground">
            <Link to={ux("/components?bom=has")} className="font-medium text-primary hover:underline">
              {componentsWithBom.withBom}
            </Link>{" "}
            of {componentsWithBom.active} components have a bill of materials
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Link to={ux("/products?missing=incomplete")} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Review incomplete products
        </Link>
      </CardFooter>
    </Card>
  )
}
