import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import {
  ACTIVITY_FILTER_KEYS,
  AUDIT_SORT_KEYS,
  activityFeedParams,
  useActivityFeed,
  type ActivityFilterKey,
  type AuditSortKey,
} from "@/api/hooks/audit";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { ActivityFeed } from "@/ux/components/patterns/activity-feed";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListSortSelect, type ListSortOption } from "@/ux/components/patterns/list-sort-select";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { EmptyState, ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Card, CardContent } from "@/ux/components/ui/card";
import { Input } from "@/ux/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { useDebouncedValue } from "@/ux/hooks/use-debounced-value";
import { errorMessage } from "@/ux/lib/api-state";

/**
 * URL filter contract for GET /audit/activity (spec 068). `"all"` is the
 * unset sentinel for every control; `from`/`to` hold `datetime-local`
 * values that `activityFeedParams` converts to ISO datetimes.
 */
const ACTIVITY_FILTERS: { [K in ActivityFilterKey]: ListFilterConfig } = {
  kind: { default: "all", values: ["all", "entity", "edge"] },
  entityType: {
    default: "all",
    values: [
      "all",
      "digital_product",
      "component",
      "component_instance",
      "component_group",
      "team",
      "line_of_business",
      "import_agent",
      "docker_target",
      "importer_source",
      "importer_config",
      "credential",
      "url_check",
      "monitoring_setup",
      "user",
      "settings",
      "session",
      "auth",
      "correction",
    ],
  },
  // `action`/`actor` are open domains (free-text columns server-side).
  action: { default: "all" },
  actor: { default: "all" },
  from: { default: "all", isValid: (v) => !Number.isNaN(Date.parse(v)) },
  to: { default: "all", isValid: (v) => !Number.isNaN(Date.parse(v)) },
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  digital_product: "Digital product",
  component: "Component",
  component_instance: "Component instance",
  component_group: "Component group",
  team: "Team",
  line_of_business: "Line of business",
  import_agent: "Import agent",
  docker_target: "Docker target",
  importer_source: "Importer source",
  importer_config: "Importer",
  credential: "Credential",
  url_check: "URL check",
  monitoring_setup: "Monitoring setup",
  user: "User",
  settings: "Settings",
  session: "Session",
  auth: "Authentication",
  correction: "Correction",
};

/** The audit feed is a card list — sort is a (sort, order) option list. */
const ACTIVITY_SORT_OPTIONS: ListSortOption<AuditSortKey>[] = [
  { sort: "createdAt", order: "desc", label: "Newest first" },
  { sort: "createdAt", order: "asc", label: "Oldest first" },
  { sort: "action", order: "asc", label: "Action A–Z" },
  { sort: "action", order: "desc", label: "Action Z–A" },
  { sort: "actor", order: "asc", label: "Actor A–Z" },
  { sort: "actor", order: "desc", label: "Actor Z–A" },
  { sort: "kind", order: "asc", label: "Kind A–Z" },
  { sort: "kind", order: "desc", label: "Kind Z–A" },
  { sort: "entityType", order: "asc", label: "Type A–Z" },
  { sort: "entityType", order: "desc", label: "Type Z–A" },
];

const isSet = (v: string) => v !== "all";

/**
 * Debounced free-text filter bound to `useListState` — same contract as
 * `useListSearch` but for filter params (spec 068 FR-006): the input stays
 * responsive while the committed value lands in the URL ~300 ms after
 * typing stops. `"all"` is the unset sentinel on both sides.
 */
function useDebouncedFilter(
  value: string,
  commit: (value: string) => void,
): [string, (value: string) => void] {
  const shown = value === "all" ? "" : value;
  const [input, setInput] = useState(shown);
  const debounced = useDebouncedValue(input);

  // URL → input: external navigation or Clear rewrites the field.
  useEffect(() => {
    setInput(shown);
  }, [shown]);

  // input → URL: commit the debounced text once it differs from state.
  // `commit` identity changes every render — the value comparison guards.
  useEffect(() => {
    const next = debounced === "" ? "all" : debounced;
    if (next !== value) commit(next);
  }, [debounced, value]);

  return [input, setInput];
}

export function UxActivityPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  // Backend defaults (activityFeedQuerySchema): createdAt desc.
  const list = useListState<AuditSortKey, ActivityFilterKey>({
    sortKeys: AUDIT_SORT_KEYS,
    defaultSort: "createdAt",
    defaultOrder: "desc",
    filters: ACTIVITY_FILTERS,
  });
  const activity = useActivityFeed(activityFeedParams(list));
  useClampPage(list, activity.data);

  // Debounced free-text filters — one request per pause, not per keystroke.
  const [actionInput, setActionInput] = useDebouncedFilter(list.filters.action, (v) =>
    list.setFilter("action", v),
  );
  const [actorInput, setActorInput] = useDebouncedFilter(list.filters.actor, (v) =>
    list.setFilter("actor", v),
  );

  const data = activity.data;
  const rows = data?.items ?? [];
  const dirty = Object.values(list.filters).some(isSet);

  const clearFilters = () => {
    for (const key of ACTIVITY_FILTER_KEYS) list.setFilter(key, "all");
  };

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Activity"
        description="An immutable audit log of every change, sign-in and import. Retained for 1 year."
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={list.filters.kind} onValueChange={(v) => list.setFilter("kind", v)}>
            <SelectTrigger size="sm" aria-label="Filter by record kind" className="w-auto min-w-32">
              <span className="text-muted-foreground">Kind:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="entity">Entities</SelectItem>
                <SelectItem value="edge">Relationships</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={list.filters.entityType}
            onValueChange={(v) => list.setFilter("entityType", v)}
          >
            <SelectTrigger size="sm" aria-label="Filter by entity type" className="w-auto min-w-44">
              <span className="text-muted-foreground">Type:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            type="search"
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            placeholder="Action"
            aria-label="Filter by action"
            className="h-8 w-32"
          />
          <Input
            type="search"
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            placeholder="Actor"
            aria-label="Filter by actor"
            className="h-8 w-36"
          />
          <Input
            type="datetime-local"
            value={list.filters.from === "all" ? "" : list.filters.from}
            onChange={(e) => list.setFilter("from", e.target.value === "" ? "all" : e.target.value)}
            aria-label="From date"
            className="h-8 w-auto"
          />
          <span className="text-sm text-muted-foreground">→</span>
          <Input
            type="datetime-local"
            value={list.filters.to === "all" ? "" : list.filters.to}
            onChange={(e) => list.setFilter("to", e.target.value === "" ? "all" : e.target.value)}
            aria-label="To date"
            className="h-8 w-auto"
          />
          {dirty && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <XIcon data-icon="inline-start" />
              Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <p className="tabular text-sm text-muted-foreground" aria-live="polite">
              {rows.length === (data?.total ?? 0)
                ? `${data?.total ?? 0} results`
                : `${rows.length} of ${data?.total ?? 0}`}
            </p>
            <ListSortSelect
              sort={list.sort}
              order={list.order}
              onSortChange={(sort, order) => list.setSort(sort, order)}
              options={ACTIVITY_SORT_OPTIONS}
            />
          </div>
        </div>
      </div>
      {activity.isPending ? (
        <Card>
          <CardContent>
            <TableSkeleton rows={8} columns={3} />
          </CardContent>
        </Card>
      ) : activity.error ? (
        <Card>
          <CardContent>
            <ErrorState
              title="Activity unavailable"
              description={errorMessage(activity.error)}
              onRetry={() => void activity.refetch()}
              className="border-0"
            />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title={dirty ? "No activity matches these filters" : "No activity yet"}
              className="border-0"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <ActivityFeed events={rows.map(mapActivityItem)} />
          </CardContent>
        </Card>
      )}
      {data && data.total > 0 && (
        <ListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={data.total}
          pageCount={data.pageCount}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
        />
      )}
    </PageContainer>
  );
}
