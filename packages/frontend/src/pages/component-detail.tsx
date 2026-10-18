import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Box, Pencil } from "lucide-react";
import { useComponentDetail, useUpdateComponent } from "@/api/hooks/components";
import { useSession } from "@/api/hooks/auth";
import { useTeams } from "@/api/hooks/org";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageSkeleton } from "@/components/states/skeletons";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";
import { StatusBadge } from "@/components/states/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { EntityHistory } from "@/components/entity-history";
import { LinksCard } from "@/components/metadata/links-card";
import { TagChips } from "@/components/metadata/tags-input";
import { SunsetBadge } from "@/components/metadata/sunset-badge";
import { ComponentMetadataForm } from "@/components/metadata/component-metadata-form";
import { relativeTime, absoluteTime, MONO_CLASS } from "@/lib/format";
import { safeUrl } from "@/components/safe-url";
import { useSetCrumbLabel } from "@/components/layout/crumb-context";
import type { ApiError } from "@/api/client";

export function ComponentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isFetching, error, refetch } = useComponentDetail(id ?? null);
  const component = data?.component;
  useSetCrumbLabel(component?.slug ?? null);
  const { data: user } = useSession();
  const { data: teamsData } = useTeams();
  const updateComponent = useUpdateComponent();
  const canEdit = ["EDITOR", "ADMIN"].includes(user?.role ?? "VIEWER");
  const [editOpen, setEditOpen] = useState(false);

  const isForbidden = error ? ((error as unknown) as ApiError).code === "FORBIDDEN" : false;

  if (isPending && !component) {
    return <PageSkeleton />;
  }

  if (isForbidden) {
    return (
      <div className="bg-background p-6">
        <Forbidden />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-background p-6">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (!component) {
    return (
      <div className="bg-background p-6">
        <ErrorState title="Component not found" onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="bg-background p-6">
      <Button variant="ghost" asChild className="mb-4">
        <Link to="/components" className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to catalog
        </Link>
      </Button>

      {isFetching && (
        <p className="mb-4 text-xs text-muted-foreground">Updating…</p>
      )}

      <div className="flex items-start gap-4 mb-6">
        <Box className="h-8 w-8 text-muted-foreground" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{component.name}</h1>
            <SunsetBadge sunsetAt={component.sunsetAt} lifecycle={component.lifecycle} />
          </div>
          <p className={`text-sm text-muted-foreground ${MONO_CLASS}`}>
            {component.slug}
          </p>
          <TagChips tags={component.tags ?? []} className="mt-1" />
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1 h-4 w-4" /> Edit metadata
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Category</span>
              <span>{component.category}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider</span>
              <span>{component.provider}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Resource type</span>
              <span className={MONO_CLASS}>{component.resourceType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Lifecycle</span>
              <StatusBadge status={component.lifecycle} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Group</span>
              <span>{component.componentGroupName ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Team owner</span>
              {canEdit ? (
                <select
                  aria-label="Team owner"
                  value={component.teamOwnerId ?? ""}
                  onChange={(e) =>
                    updateComponent.mutate({
                      id: component.id,
                      teamOwnerId: e.target.value || null,
                    })
                  }
                  className="h-8 max-w-40 rounded-md border border-input bg-background px-2 text-sm"
                  disabled={updateComponent.isPending}
                >
                  <option value="">Unassigned</option>
                  {(teamsData?.teams ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{component.teamOwnerName ?? "—"}</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last seen</span>
              <span title={absoluteTime(component.lastSeenAt)}>
                {relativeTime(component.lastSeenAt)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span title={absoluteTime(component.createdAt)}>
                {relativeTime(component.createdAt)}
              </span>
            </div>
          </CardContent>
        </Card>

        <LinksCard links={component.links ?? []} />

        {component.details && Object.keys(component.details).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
                {JSON.stringify(component.details, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instances</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {component.instances.length === 0 ? (
            <EmptyState
              icon={Box}
              title="No active instances found"
              description="This component has no discovered instances."
            />
          ) : (
            <Table aria-label="Component instances">
              <TableHeader>
                <TableRow>
                  <TableHead>Environment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {component.instances.map((instance) => {
                  const url = safeUrl(instance.url);
                  return (
                    <TableRow key={instance.id}>
                      <TableCell>{instance.environment}</TableCell>
                      <TableCell>
                        <StatusBadge status={instance.status} />
                      </TableCell>
                      <TableCell>{instance.version ?? "—"}</TableCell>
                      <TableCell>{instance.region ?? "—"}</TableCell>
                      <TableCell>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {instance.url}
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityHistory entityType="component" entityId={component.id} />
        </CardContent>
      </Card>

      <ComponentMetadataForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        component={component}
      />
    </div>
  );
}
