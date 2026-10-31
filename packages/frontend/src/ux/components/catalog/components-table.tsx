
import { flags } from "@/ux/lib/flags";
import { ux } from "@/ux/lib/paths";
import { Link } from "react-router-dom"
import * as React from "react"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { EmptyState } from "@/ux/components/patterns/states"
import { HealthBadge, LifecycleBadge } from "@/ux/components/patterns/status-badge"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { CATEGORY_LABELS, PROVIDER_META, type InstanceStatus } from "@/ux/lib/domain"
import type { Component } from "@/ux/lib/view-types"

const PRIORITY: InstanceStatus[] = ["ERROR", "GONE", "STOPPED", "RUNNING"]
// Spec 039: prefer the backend rollup; fall back to client-computed for payloads that carry instances.
const worstStatus = (c: Component) => c.worstStatus ?? PRIORITY.find((s) => c.instances.some((i) => i.status === s)) ?? null

export function ComponentsTable({
  data,
  includeGone,
  onIncludeGoneChange,
}: {
  data: Component[];
  includeGone?: boolean;
  onIncludeGoneChange?: (v: boolean) => void;
}) {
  const [query, setQuery] = React.useState("")
  const [provider, setProvider] = React.useState("all")
  const [category, setCategory] = React.useState("all")

  const providers = [...new Set(data.map((c) => c.provider))].map((p) => ({ value: p, label: PROVIDER_META[p].label }))
  const categories = [...new Set(data.map((c) => c.category))].map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c }))

  const rows = data.filter(
    (c) =>
      (provider === "all" || c.provider === provider) &&
      (category === "all" || c.category === category) &&
      (query === "" || `${c.name} ${c.resourceType} ${c.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search name, resource type, tag"
        resultCount={rows.length}
        total={data.length}
        filters={[
          { id: "provider", label: "Provider", value: provider, onChange: setProvider, options: providers },
          { id: "category", label: "Category", value: category, onChange: setCategory, options: categories },
          ...(onIncludeGoneChange
            ? [{
                id: "gone",
                label: "Gone instances",
                value: includeGone ? "show" : "hide",
                onChange: (v: string) => onIncludeGoneChange(v === "show"),
                options: [
                  { value: "hide", label: "Hidden" },
                  { value: "show", label: "Shown" },
                ],
              }]
            : []),
        ]}
      />
      <Card className="overflow-hidden py-0">
        {rows.length === 0 ? (
          <EmptyState title="No components match" description="Try a different search or clear the filters." className="border-0" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Component</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Resource type</TableHead>
                <TableHead>Owner</TableHead>
                {flags.componentListHealth && <TableHead>Health</TableHead>}
                <TableHead className="text-right">Instances</TableHead>
                {flags.componentListLastSeen && <TableHead className="pr-4 text-right">Last seen</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <Link to={ux(`/components/${c.slug}`)} className="flex items-center gap-2.5 underline-offset-4 hover:underline">
                      <ProviderMark provider={c.provider} size="sm" />
                      <span className="font-mono text-sm">{c.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell>{CATEGORY_LABELS[c.category] ?? c.category}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{c.resourceType}</code>
                  </TableCell>
                  <TableCell className="text-sm">{c.teamOwnerName ?? <span className="text-muted-foreground">Unowned</span>}</TableCell>
                  {flags.componentListHealth && <TableCell>{c.lifecycle === "RETIRED" ? <LifecycleBadge value="RETIRED" /> : <HealthBadge value={worstStatus(c)} />}</TableCell>}
                  <TableCell className="tabular text-right">{c.instanceCount}</TableCell>
                  {flags.componentListLastSeen && <TableCell className="pr-4 text-right text-sm text-muted-foreground"><RelativeTime iso={c.lastSeenAt} /></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
