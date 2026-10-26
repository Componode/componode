import { InviteUserDialog } from "@/ux/components/admin/invite-user-dialog";
import { UsersTable } from "@/ux/components/admin/users-table";
import { useSession } from "@/ux/components/app/session-context";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useUsers } from "@/api/hooks/users";
import { mapUser } from "@/api/mappers/operations";
import { errorMessage } from "@/ux/lib/api-state";

export function UxUsersPage() {
  const { user } = useSession();
  const users = useUsers();

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="Workspace accounts and their roles. Roles gate what people can change."
        actions={<InviteUserDialog />}
      />
      {users.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={5} columns={4} />
        </Card>
      ) : users.error ? (
        <ErrorState description={errorMessage(users.error)} onRetry={() => void users.refetch()} />
      ) : (
        <UsersTable data={users.data.users.map(mapUser)} selfId={user.id} />
      )}
    </PageContainer>
  );
}
