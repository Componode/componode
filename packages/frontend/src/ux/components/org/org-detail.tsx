import type { ReactNode } from "react";
import { Building2Icon, UsersIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { OrgFormDialog } from "@/ux/components/org/org-form-dialog";
import { DangerZone } from "@/ux/components/patterns/danger-zone";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { DescriptionList } from "@/ux/components/patterns/primitives";
import { LifecycleBadge } from "@/ux/components/patterns/status-badge";
import { EmptyState } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import { ux } from "@/ux/lib/paths";
import type { OrgEntity } from "@/api/types";
import type { Component, Product } from "@/ux/lib/view-types";

interface OwnedTableProps {
  rows: { id: string; slug: string; name: string; meta?: ReactNode; right?: ReactNode }[];
  noun: string;
  hrefBase: string;
  empty: string;
  metaLabel?: string;
}

function OwnedTable({ rows, noun, hrefBase, empty, metaLabel = "Lifecycle" }: OwnedTableProps) {
  if (rows.length === 0) {
    return <EmptyState icon={UsersIcon} title={`No owned ${noun}`} description={empty} />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead className="pl-4 capitalize">{noun.slice(0, -1)}</TableHead>
          <TableHead>{metaLabel}</TableHead>
          <TableHead className="pr-4 text-right">—</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="pl-4">
              <Link to={ux(`${hrefBase}/${r.slug}`)} className="font-medium hover:underline">
                {r.name}
              </Link>
            </TableCell>
            <TableCell>{r.meta}</TableCell>
            <TableCell className="tabular pr-4 text-right text-sm text-muted-foreground">{r.right}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface OrgDetailProps {
  noun: "team" | "line of business";
  entity: OrgEntity;
  icon: "team" | "lob";
  stats: { label: string; value: ReactNode }[];
  ownedProducts: Product[];
  ownedComponents: Component[];
  /** When >0 the DangerZone delete action is blocked. */
  ownedTotal: number;
  /** Overrides the default blocked-delete message (e.g. LOBs also count teams). */
  blockedReason?: string;
  /** LOB options for the team edit dialog (spec 034). */
  lobs?: OrgEntity[];
  /** Teams associated with this LOB — renders a teams card (spec 034). */
  associatedTeams?: OrgEntity[];
  onEdit: (vars: { name: string; slug: string; description?: string | null; lobId?: string | null }) => void;
  onDelete: () => void;
  editPending?: boolean;
}

export function OrgDetail({
  noun,
  entity,
  icon,
  stats,
  ownedProducts,
  ownedComponents,
  ownedTotal,
  blockedReason: blockedReasonProp,
  lobs,
  associatedTeams,
  onEdit,
  onDelete,
  editPending,
}: OrgDetailProps) {
  const Icon = icon === "team" ? UsersIcon : Building2Icon;
  return (
    <PageContainer>
      <PageHeader
        media={
          <div className="flex size-12 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <Icon className="size-6" aria-hidden="true" />
          </div>
        }
        title={entity.name}
        description={
          entity.description ??
          (noun === "team"
            ? "Accountable for the products and components below. Ownership drives notifications and incident routing."
            : "Every product rolls up to exactly one line of business.")
        }
        meta={<code className="font-mono text-xs text-muted-foreground">{entity.slug}</code>}
        actions={
          <OrgFormDialog
            noun={noun}
            initial={entity}
            lobs={lobs}
            onSubmit={({ name, slug, description, lobId }) => onEdit({ name, slug, description, lobId })}
            pending={editPending}
            trigger={<Button variant="outline">Edit {noun}</Button>}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList items={stats} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-2">
          {associatedTeams && (
            <Card className="overflow-hidden py-0">
              <CardHeader className="pt-6">
                <CardTitle>Teams</CardTitle>
                <CardDescription>Teams associated with this line of business.</CardDescription>
              </CardHeader>
              <OwnedTable
                noun="teams"
                hrefBase="/teams"
                empty="Assign a team's line of business to see it here."
                metaLabel="Slug"
                rows={associatedTeams.map((t) => ({
                  id: t.id,
                  slug: t.slug,
                  name: t.name,
                  meta: <code className="font-mono text-xs text-muted-foreground">{t.slug}</code>,
                }))}
              />
            </Card>
          )}

          <Card className="overflow-hidden py-0">
            <CardHeader className="pt-6">
              <CardTitle>Products</CardTitle>
              <CardDescription>Products this {noun} owns.</CardDescription>
            </CardHeader>
            <OwnedTable
              noun="products"
              hrefBase="/products"
              empty="Assign this owner on a product to see it here."
              rows={ownedProducts.map((p) => ({
                id: p.id,
                slug: p.slug,
                name: p.name,
                meta: <LifecycleBadge value={p.lifecycle} />,
                right: p.componentCount,
              }))}
            />
          </Card>

          <Card className="overflow-hidden py-0">
            <CardHeader className="pt-6">
              <CardTitle>Components</CardTitle>
              <CardDescription>Components this {noun} owns.</CardDescription>
            </CardHeader>
            <OwnedTable
              noun="components"
              hrefBase="/components"
              empty="Components owned here appear once assigned."
              rows={ownedComponents.map((c) => ({
                id: c.id,
                slug: c.slug,
                name: c.name,
                meta: <LifecycleBadge value={c.lifecycle} />,
                right: c.instanceCount,
              }))}
            />
          </Card>
        </div>
      </div>

      <DangerZone
        actions={[
          {
            id: "delete",
            title: `Delete ${noun}`,
            description: `Removes ${entity.name} permanently.`,
            buttonLabel: `Delete ${noun}`,
            variant: "destructive",
            confirmTitle: `Delete ${entity.name}?`,
            confirmDescription: "The record is removed permanently.",
            confirmLabel: `Delete ${noun}`,
            typeToConfirm: entity.slug,
            blockedReason:
              ownedTotal > 0
                ? (blockedReasonProp ??
                  `Reassign the ${ownedTotal} product${ownedTotal === 1 ? "" : "s"}/components it owns first.`)
                : undefined,
            successMessage: `${entity.name} deleted`,
            onConfirm: onDelete,
          },
        ]}
      />
    </PageContainer>
  );
}
