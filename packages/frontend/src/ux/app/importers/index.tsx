import { Link } from "react-router-dom";
import { PlusIcon } from "lucide-react";
import { useCredentials } from "@/api/hooks/credentials";
import { useImporterConfigs } from "@/api/hooks/importers";
import { mapImporterConfig } from "@/api/mappers/operations";
import { ImporterCard } from "@/ux/components/importers/importer-card";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { EmptyState, ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { CableIcon } from "lucide-react";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { errorMessage } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxImportersPage() {
  const configs = useImporterConfigs();
  const credentials = useCredentials();

  if (configs.isPending || credentials.isPending) {
    return (
      <PageContainer>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="py-0">
            <TableSkeleton rows={3} columns={2} />
          </Card>
        </div>
      </PageContainer>
    );
  }
  const err = configs.error ?? credentials.error;
  if (err) {
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void configs.refetch()} />
      </PageContainer>
    );
  }

  const items = (configs.data?.configs ?? []).map((c) =>
    mapImporterConfig(c, credentials.data?.credentials ?? []),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Importers"
        description="Scheduled connections that discover components and instances from your cloud providers and tools."
        actions={
          <Button asChild>
            <Link to={ux("/importers/new")}>
              <PlusIcon data-icon="inline-start" />
              Add importer
            </Link>
          </Button>
        }
      />
      {items.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={CableIcon}
            title="No importers configured"
            description="Add an importer to start discovering components on a schedule."
          />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <li key={i.id}>
              <ImporterCard importer={i} />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
