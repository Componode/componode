import { LayersIcon } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useComponentGroup, useDeleteComponentGroup, useUpdateComponentGroup } from "@/api/hooks/component-groups";
import { useComponents } from "@/api/hooks/components";
import { useTeams } from "@/api/hooks/org";
import { mapComponentGroup } from "@/api/mappers/catalog";
import { DangerZone } from "@/ux/components/patterns/danger-zone";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { DescriptionList } from "@/ux/components/patterns/primitives";
import { LifecycleBadge } from "@/ux/components/patterns/status-badge";
import { EmptyState, ErrorState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/ux/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { Textarea } from "@/ux/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import { errorMessage, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxComponentGroupDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  // Direct detail read — `GET /component-groups/:id` accepts the route slug (spec 033).
  const groupQ = useComponentGroup(slug);
  const group = groupQ.data?.group;
  const members = useComponents(
    { group: group?.id, includeRetired: true, pageSize: 100 },
  );
  const deleteGroup = useDeleteComponentGroup();
  const updateGroup = useUpdateComponentGroup();
  const teams = useTeams();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = React.useState(false);

  if (groupQ.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Card className="py-0">
          <TableSkeleton rows={5} columns={3} />
        </Card>
      </PageContainer>
    );
  }

  if (groupQ.error) {
    return (
      <PageContainer>
        {isNotFound(groupQ.error) ? (
          <NotFoundState backHref={ux("/component-groups")} backLabel="All groups" />
        ) : (
          <ErrorState description={errorMessage(groupQ.error)} onRetry={() => void groupQ.refetch()} />
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
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Edit group</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit group</DialogTitle>
                <DialogDescription>Update the group name, owner, and lifecycle.</DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  updateGroup.mutate(
                    {
                      id: group.id,
                      name: String(fd.get("name") ?? "").trim() || undefined,
                      description: String(fd.get("description") ?? "").trim() || undefined,
                      lifecycle: String(fd.get("lifecycle") ?? "") || undefined,
                      teamOwnerId: String(fd.get("team") ?? "") || undefined,
                    },
                    {
                      onSuccess: () => {
                        toast.success("Group updated");
                        setEditOpen(false);
                      },
                      onError: (err) => toast.error(errorMessage(err)),
                    },
                  );
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="edit-group-name">Name</FieldLabel>
                    <Input id="edit-group-name" name="name" defaultValue={view.name} required maxLength={100} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="edit-group-desc">Description</FieldLabel>
                    <Textarea id="edit-group-desc" name="description" defaultValue={view.description ?? ""} maxLength={500} />
                  </Field>
                  <Field>
                    <FieldLabel>Owning team</FieldLabel>
                    <Select name="team" defaultValue={group.teamOwnerId ?? ""}>
                      <SelectTrigger aria-label="Owning team"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        {(teams.data?.items ?? []).map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Lifecycle</FieldLabel>
                    <Select name="lifecycle" defaultValue={group.lifecycle}>
                      <SelectTrigger aria-label="Lifecycle"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="RETIRED">Retired</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
                <DialogFooter className="mt-4">
                  <Button type="submit" disabled={updateGroup.isPending}>Save changes</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
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
