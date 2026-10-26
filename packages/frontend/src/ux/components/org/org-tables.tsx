import { Building2Icon, UsersIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import { EmptyState } from "@/ux/components/patterns/states";
import { ux } from "@/ux/lib/paths";
import type { OrgEntity, TeamEntity } from "@/api/types";

export interface OrgCounts {
  products: number;
  teams?: number;
  components?: number;
  members?: number;
}

/** Teams list — members/products/components counts resolved by the route. */
export function TeamsTable({
  data,
  counts,
}: {
  data: TeamEntity[];
  counts: Map<string, OrgCounts>;
}) {
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
            <TableHead className="pl-4">Team</TableHead>
            <TableHead>Line of business</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="text-right">Products</TableHead>
            <TableHead className="pr-4 text-right">Components</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((t) => {
            const c = counts.get(t.id);
            return (
              <TableRow key={t.id}>
                <TableCell className="pl-4">
                  <div className="flex flex-col">
                    <Link to={ux(`/teams/${t.slug}`)} className="font-medium hover:underline">
                      {t.name}
                    </Link>
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
                <TableCell className="tabular text-right">{c?.members ?? "—"}</TableCell>
                <TableCell className="tabular text-right">{c?.products ?? 0}</TableCell>
                <TableCell className="tabular pr-4 text-right">{c?.components ?? 0}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

/** LOB grid — products owned + teams associated (spec 034). */
export function LobsGrid({ data, counts }: { data: OrgEntity[]; counts: Map<string, OrgCounts> }) {
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
      {data.map((l) => {
        const c = counts.get(l.id);
        return (
          <li key={l.id}>
            <Card className="relative h-full transition-colors hover:border-primary/40">
              <CardHeader>
                <span className="mb-2 flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Building2Icon className="size-4" aria-hidden="true" />
                </span>
                <CardTitle>
                  <Link to={ux(`/lobs/${l.slug}`)} className="after:absolute after:inset-0 hover:underline">
                    {l.name}
                  </Link>
                </CardTitle>
                <CardDescription className="line-clamp-2">{l.description ?? "—"}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <dl className="grid grid-cols-2 gap-3 rounded-md bg-muted/50 p-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Products</dt>
                    <dd className="tabular text-lg font-semibold">{c?.products ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Teams</dt>
                    <dd className="tabular text-lg font-semibold">{c?.teams ?? "—"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
