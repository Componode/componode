import { Link } from "react-router-dom";
import { PlusIcon, ShieldCheckIcon } from "lucide-react";
import {
  CREDENTIAL_SORT_KEYS,
  useCredentialsList,
  type CredentialFilterKey,
  type CredentialSortKey,
} from "@/api/hooks/credentials";
import { mapCredential } from "@/api/mappers/operations";
import { CredentialsTable } from "@/ux/components/admin/credentials-table";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListToolbar } from "@/ux/components/patterns/list-toolbar";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { CREDENTIAL_STATUS_META, type CredentialStatus } from "@/ux/lib/domain";
import { errorMessage } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

/**
 * URL filter contract for GET /credentials: `status` passes through to the
 * API verbatim (CREDENTIAL_STATUSES enum); "all" is the unset sentinel —
 * omitted from the query string by `buildListQueryString`.
 */
const CREDENTIAL_FILTERS: { [K in CredentialFilterKey]: ListFilterConfig } = {
  status: { default: "all", values: ["all", "ACTIVE", "REVOKED"] },
};

export function UxCredentialsPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  // Backend defaults (listCredentialsQuerySchema): createdAt desc.
  const list = useListState<CredentialSortKey, CredentialFilterKey>({
    sortKeys: CREDENTIAL_SORT_KEYS,
    defaultSort: "createdAt",
    defaultOrder: "desc",
    filters: CREDENTIAL_FILTERS,
  });
  const [query, setQuery] = useListSearch(list);
  const credentials = useCredentialsList(list);
  useClampPage(list, credentials.data?.pagination);

  const rows = credentials.data?.data ?? [];
  const pagination = credentials.data?.pagination;

  return (
    <PageContainer>
      <PageHeader
        title="Credentials"
        description="Provider secrets importers authenticate with. Values are write-only — only masked hints are stored views."
        actions={
          <Button asChild>
            <Link to={ux("/credentials/new")}>
              <PlusIcon data-icon="inline-start" />
              New credential
            </Link>
          </Button>
        }
      />
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>Write-only by design</AlertTitle>
        <AlertDescription>
          You can rotate or revoke a credential, but its secret is never readable — only a hint of the last characters.
        </AlertDescription>
      </Alert>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search credentials"
        resultCount={rows.length}
        total={pagination?.total ?? 0}
        filters={[
          {
            id: "status",
            label: "Status",
            value: list.filters.status,
            onChange: (v) => list.setFilter("status", v),
            options: (Object.keys(CREDENTIAL_STATUS_META) as CredentialStatus[]).map((s) => ({
              value: s,
              label: CREDENTIAL_STATUS_META[s].label,
            })),
          },
        ]}
      />
      {credentials.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={5} columns={6} />
        </Card>
      ) : credentials.error ? (
        <ErrorState description={errorMessage(credentials.error)} onRetry={() => void credentials.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <CredentialsTable
            data={rows.map((c) => mapCredential(c))}
            sort={list.sort}
            order={list.order}
            onSortChange={(sort, order) => list.setSort(sort as CredentialSortKey | null, order)}
          />
          {pagination && pagination.total > 0 && (
            <ListPagination
              page={list.page}
              pageSize={list.pageSize}
              total={pagination.total}
              pageCount={pagination.pageCount}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          )}
        </div>
      )}
    </PageContainer>
  );
}
