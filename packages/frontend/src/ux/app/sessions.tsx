import { SessionsTable } from "@/ux/components/admin/sessions-table";
import { useSession } from "@/ux/components/app/session-context";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useSessions } from "@/api/hooks/sessions";
import { mapSession } from "@/api/mappers/operations";
import { errorMessage } from "@/ux/lib/api-state";

/** Lists the caller's own sessions (GET /sessions is self-scoped). */
export function UxSessionsPage() {
  const { user } = useSession();
  const sessions = useSessions();

  return (
    <PageContainer>
      <PageHeader
        title="Sessions"
        description="Your active sign-ins. Revoke a session to sign that device out immediately."
      />
      {sessions.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={4} columns={5} />
        </Card>
      ) : sessions.error ? (
        <ErrorState description={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
      ) : (
        <SessionsTable
          showOwner={false}
          data={sessions.data.sessions.map((s) =>
            mapSession(s, { username: user.username, displayName: user.displayName ?? user.username }),
          )}
        />
      )}
    </PageContainer>
  );
}
