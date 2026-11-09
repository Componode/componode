import { useParams } from "react-router-dom";
import { UserDetail } from "@/ux/components/admin/user-detail";
import { useLeafCrumb } from "@/ux/components/app/app-header";
import { useSession } from "@/ux/components/app/session-context";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState } from "@/ux/components/patterns/states";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { useUsers } from "@/api/hooks/users";
import { useUserSessions } from "@/api/hooks/sessions";
import { usePagedActivityFeed } from "@/ux/hooks/use-entity-history";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { mapSession, mapUser } from "@/api/mappers/operations";
import { errorMessage, isForbidden } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user: self } = useSession();
  // No detail GET — resolve via the users list (wiring contract).
  const users = useUsers();
  const apiUser = users.data?.users.find((u) => u.id === id);
  useLeafCrumb(apiUser ? (apiUser.displayName ?? apiUser.username) : null);
  const sessions = useUserSessions(apiUser ? apiUser.id : null);
  const activity = usePagedActivityFeed({ actor: apiUser?.username });

  if (users.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (users.error) {
    return (
      <PageContainer>
        {isForbidden(users.error) ? (
          <ForbiddenState />
        ) : (
          <ErrorState description={errorMessage(users.error)} onRetry={() => void users.refetch()} />
        )}
      </PageContainer>
    );
  }
  if (!apiUser) {
    return (
      <PageContainer>
        <NotFoundState backHref={ux("/users")} backLabel="All users" />
      </PageContainer>
    );
  }

  const view = mapUser(apiUser);
  return (
    <UserDetail
      user={view}
      sessions={(sessions.data?.sessions ?? []).map((s) =>
        mapSession(s, { username: view.username, displayName: view.displayName ?? view.username }),
      )}
      events={(activity.data?.items ?? []).map(mapActivityItem)}
      activityPagination={activity.pagination}
      isSelf={apiUser.id === self.id}
    />
  );
}
