import { LayersIcon } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useComponentGroups, useDeleteComponentGroup } from "@/api/hooks/component-groups";
import { useComponents } from "@/api/hooks/components";
import { mapComponentGroup } from "@/api/mappers/catalog";
import { DangerZone } from "@/ux/components/patterns/danger-zone";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { DescriptionList } from "@/ux/components/patterns/primitives";
import { LifecycleBadge } from "@/ux/components/patterns/status-badge";
import { EmptyState, ErrorState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import { errorMessage, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxComponentGroupDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  // Slug→id per wiring contract: groups are addressed by id but routes
  // keep the prototype's slug convention — resolve via the list.
  const groups = useComponentGroups();
  const group = groups.data?.groups.find((g) => g.slug === slug);
  const members = useComponents(
    { group: group?.id, includeRetired: true, pageSize: 100 },
  );
  const deleteGroup = useDeleteComponentGroup();
  const navigate = useNavigate();

  if (groups.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Card className="py-0">
          <TableSkeleton rows={5} columns={3} />
        </Card>
      </PageContainer>
    );
  }

  if (groups.error) {
    return (
      <PageContainer>
        {isNotFound(groups.error) ? (
          <NotFoundState backHref={ux("/component-groups")} backLabel="All groups" />
        ) : (
          <ErrorState description={errorMessage(groups.error)} onRetry={() => void groups.refetch()} />
        )}
      </PageContainer>
    );
  }

  if (!group) {
    return (
      <PageContainer>
        <NotFoundState
          title="Component group not found"
          description={`No group matches “${slug}”.`}
          backHref={ux("/component-groups")}
          backLabel="All groups"
        />
      </PageContainer>
    );
  }

  const view = mapComponentGroup(group);

  return (
    <PageContainer>
      <PageHeader
        media={
          <div className="flex size-12 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <LayersIcon className="size-6" aria-hidden="true" />
          </div>
        }
        title={view.name}
        description="Components in a group ship and retire together."
        meta={
          <>
            <LifecycleBadge value={view.lifecycle} />
            <code className="font-mono text-xs text-muted-foreground">{view.slug}</code>
          </>
        }
        actions={
          <Button variant="outline" disabled title="Edit form lands with the admin pass">
            Edit group
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                { label: "Lifecycle", value: <LifecycleBadge value={view.lifecycle} /> },
                {
                  label: "Owning team",
                  value: view.team ?? "None",
                },
                { label: "Description", value: view.description ?? "—" },
                { label: "Components", value: view.members },
              ]}
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden py-0 lg:col-span-2">
          <CardHeader className="pt-6">
            <CardTitle>Members</CardTitle>
            <CardDescription>Components currently assigned to this group.</CardDescription>
          </CardHeader>
          {members.isPending ? (
            <TableSkeleton rows={4} columns={3} />
          ) : members.error ? (
            <ErrorState description={errorMessage(members.error)} onRetry={() => void members.refetch()} className="border-0" />
          ) : (members.data?.data ?? []).length === 0 ? (
            <EmptyState
              icon={LayersIcon}
              title="No components to show"
              description="Components assigned to this group appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Component</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="pr-4 text-right">Instances</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members.data?.data ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-4">
                      <Link to={ux(`/components/${c.slug}`)} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.category}</TableCell>
                    <TableCell className="tabular pr-4 text-right">{c.instanceCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <DangerZone
        actions={[
          {
            id: "delete",
            title: "Delete group",
            description: "Members are kept and become ungrouped.",
            buttonLabel: "Delete group",
            variant: "destructive",
            confirmTitle: `Delete ${view.name}?`,
            confirmDescription: `${view.members} components become ungrouped. The components themselves are not deleted.`,
            confirmLabel: "Delete group",
            typeToConfirm: view.slug,
            successMessage: `${view.name} deleted`,
            onConfirm: () =>
              deleteGroup.mutate(view.id, {
                onSuccess: () => {
                  toast.success(`${view.name} deleted`);
                  navigate(ux("/component-groups"));
                },
                onError: (e) => toast.error(errorMessage(e)),
              }),
          },
        ]}
      />
    </PageContainer>
  );
}
