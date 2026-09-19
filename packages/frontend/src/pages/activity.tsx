import { useState } from "react";
import { Activity, RotateCcw } from "lucide-react";
import { useActivityFeed, type ActivityFeedQuery } from "@/api/hooks/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FacetFilter, type FacetOption } from "@/components/facet-filter";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states/error-state";
import { EmptyState } from "@/components/states/empty-state";
import type { ActivityFeedItem } from "@componode/core";

const PAGE_SIZE = 50;

const KIND_OPTIONS: readonly FacetOption<"entity" | "edge">[] = [
  { value: "entity", label: "Entity" },
  { value: "edge", label: "Edge" },
];

function formatTime(iso: string) {
  return new Date(iso).toLocaleString();
}

function describeItem(item: ActivityFeedItem) {
  if (item.kind === "edge") {
    return `${item.edgeType} edge ${item.action} between ${item.fromEntityType}:${item.fromEntityId} and ${item.toEntityType}:${item.toEntityId}`;
  }
  if (item.entityType === "auth" || item.entityId === null) {
    return item.action;
  }
  return `${item.entityType}:${item.entityId} — ${item.action}`;
}

export function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFeedQuery>({
    limit: PAGE_SIZE,
    offset: 0,
  });

  const { data, isPending, error, refetch } = useActivityFeed(filters);

  function updateFilter<T extends keyof ActivityFeedQuery>(key: T, value: ActivityFeedQuery[T]) {
    setFilters((prev) => ({ ...prev, [key]: value === "" ? undefined : value, offset: 0 }));
  }

  return (
    <div className="bg-background p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Activity</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Kind</Label>
              <FacetFilter
                title="Kind"
                options={KIND_OPTIONS}
                selected={filters.kind ? [filters.kind] : []}
                onChange={(v) => updateFilter("kind", v[0] as ActivityFeedQuery["kind"])}
                mode="single"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entityType">Entity type</Label>
              <Input
                id="entityType"
                value={filters.entityType ?? ""}
                onChange={(e) => updateFilter("entityType", e.target.value)}
                placeholder="e.g. digital_product"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="action">Action</Label>
              <Input
                id="action"
                value={filters.action ?? ""}
                onChange={(e) => updateFilter("action", e.target.value)}
                placeholder="e.g. updated"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="actor">Actor</Label>
              <Input
                id="actor"
                value={filters.actor ?? ""}
                onChange={(e) => updateFilter("actor", e.target.value)}
                placeholder="Name or id"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Audit entries will appear here when mutations occur."
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Showing {data.items.length} of {data.total} entries
          </p>
          <Table aria-label="Activity feed">
            <TableCaption>Showing {data.items.length} of {data.total} activity entries</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Action / Entity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={`${item.kind}-${item.id}`}>
                  <TableCell>{formatTime(item.createdAt)}</TableCell>
                  <TableCell>{item.createdByName ?? item.createdBy ?? "—"}</TableCell>
                  <TableCell className="capitalize">{item.kind}</TableCell>
                  <TableCell>{describeItem(item)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              aria-label="Previous page"
              disabled={(filters.offset ?? 0) === 0}
              onClick={() =>
                setFilters((prev) => ({ ...prev, offset: Math.max(0, (prev.offset ?? 0) - PAGE_SIZE) }))
              }
            >
              Previous
            </Button>
            <Button
              variant="outline"
              aria-label="Next page"
              disabled={(filters.offset ?? 0) + PAGE_SIZE >= (data?.total ?? 0)}
              onClick={() =>
                setFilters((prev) => ({ ...prev, offset: (prev.offset ?? 0) + PAGE_SIZE }))
              }
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
