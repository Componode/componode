import { flags } from "@/ux/lib/flags";
import { Building2Icon, UsersIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/ux/components/ui/table";
import { EmptyState } from "@/ux/components/patterns/states";
import { RelativeTime } from "@/ux/components/patterns/primitives";
import { SortableTableHead, type ListSortBindings } from "@/ux/components/patterns/sortable-header";
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary";
import { ux } from "@/ux/lib/paths";
import type { LobListItem, TeamListItem } from "@/api/types";

/**
 * Teams list — spec 068: server-paginated rows carry their own counts
 * (`memberCount`/`componentCount`/`productCount`), so no route-level
 * fetch-all counting. FR-005: every displayed column is sortable — the
 * count headers send the same keys the backend orders by (the count
 * subquery aliases).
 */
export function TeamsTable({ data, sort, order, onSortChange }: { data: TeamListItem[] } & ListSortBindings) {
  if (data.length === 0) {
    return (
      <Card className="py-0">
        <EmptyState icon={UsersIcon} title="No teams yet" description="Create a team to assign product and component ownership." />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <SortableTableHead sortKey="name" sort={sort} order={order} onSortChange={onSortChange} className="pl-4">
              Team
            </SortableTableHead>
            <SortableTableHead sortKey="lob" sort={sort} order={order} onSortChange={onSortChange}>
              Line of business
            </SortableTableHead>
            {flags.teamMemberCounts && (
              <SortableTableHead sortKey="memberCount" sort={sort} order={order} onSortChange={onSortChange} className="text-right">
                Members
              </SortableTableHead>
            )}
            <SortableTableHead sortKey="productCount" sort={sort} order={order} onSortChange={onSortChange} className="text-right">
              Products
            </SortableTableHead>
            <SortableTableHead sortKey="componentCount" sort={sort} order={order} onSortChange={onSortChange} className="text-right">
              Components
            </SortableTableHead>
            <SortableTableHead sortKey="createdAt" sort={sort} order={order} onSortChange={onSortChange} className="pr-4">
              Created
            </SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="max-w-56 pl-4">
                <div className="flex flex-col">
                  <TitleWithSummary
                    title={
                      <Link to={ux(`/teams/${t.slug}`)} className="font-medium hover:underline">
                        {t.name}
                      </Link>
                    }
                    titleText={t.name}
                    summary={{ kind: "team", row: t }}
                    className="truncate"
                  />
                  <code className="font-mono text-xs text-muted-foreground">{t.slug}</code>
                </div>
              </TableCell>
              <TableCell>
                {t.lob ? (
                  <Link to={ux(`/lobs/${t.lob.slug}`)} className="hover:underline">
                    {t.lob.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              {flags.teamMemberCounts && <TableCell className="tabular text-right">{t.memberCount}</TableCell>}
              <TableCell className="tabular text-right">{t.productCount ?? "—"}</TableCell>
              <TableCell className="tabular text-right">{t.componentCount}</TableCell>
              <TableCell className="pr-4 text-sm text-muted-foreground">
                <RelativeTime iso={t.createdAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/**
 * LOB card grid — spec 068: counts (`productCount`/`teamCount`) arrive on
 * the list rows, replacing the pages' fetch-all products/teams counting.
 * Sort lives in the page toolbar (`ListSortSelect`) — cards have no header
 * row. The title keeps its stretched link (the card-wide click target), so
 * it deliberately does not truncate; the hover summary carries the detail.
 */
export function LobsGrid({ data }: { data: LobListItem[] }) {
  if (data.length === 0) {
    return (
      <Card className="py-0">
        <EmptyState
          icon={Building2Icon}
          title="No lines of business"
          description="Lines of business sit at the top of the ownership tree — every product rolls up to one."
        />
      </Card>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {data.map((l) => (
        <li key={l.id}>
          <Card className="relative h-full transition-colors hover:border-primary/40">
            <CardHeader>
              <span className="mb-2 flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Building2Icon className="size-4" aria-hidden="true" />
              </span>
              <CardTitle>
                <TitleWithSummary
                  title={
                    <Link to={ux(`/lobs/${l.slug}`)} className="after:absolute after:inset-0 hover:underline">
                      {l.name}
                    </Link>
                  }
                  titleText={l.name}
                  summary={{ kind: "lob", row: l }}
                />
              </CardTitle>
              <CardDescription className="line-clamp-2">{l.description ?? "—"}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <dl className="grid grid-cols-2 gap-3 rounded-md bg-muted/50 p-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Products</dt>
                  <dd className="tabular text-lg font-semibold">{l.productCount ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Teams</dt>
                  <dd className="tabular text-lg font-semibold">{l.teamCount ?? "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
