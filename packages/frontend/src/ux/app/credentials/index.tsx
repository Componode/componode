import { Link } from "react-router-dom";
import { PlusIcon } from "lucide-react";
import { CredentialsTable } from "@/ux/components/admin/credentials-table";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { useCredentials } from "@/api/hooks/credentials";
import { mapCredential } from "@/api/mappers/operations";
import { errorMessage } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxCredentialsPage() {
  const credentials = useCredentials();

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
      {credentials.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={5} columns={6} />
        </Card>
      ) : credentials.error ? (
        <ErrorState description={errorMessage(credentials.error)} onRetry={() => void credentials.refetch()} />
      ) : (
        <CredentialsTable data={credentials.data.credentials.map((c) => mapCredential(c))} />
      )}
    </PageContainer>
  );
}
