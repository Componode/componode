import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "@/api/hooks/auth";
import { ForbiddenState, TableSkeleton } from "@/ux/components/patterns/states";

const ROLE_LEVEL: Record<string, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
};

/**
 * Session gate: unauthenticated → `/login`; insufficient role →
 * ForbiddenState. Guards are advisory UX — the API remains authoritative.
 */
export function AuthGuard({ children, requiredRole }: { children: ReactNode; requiredRole?: string }) {
  const { data: user, isPending } = useSession();

  if (isPending) {
    return (
      <div className="p-6">
        <TableSkeleton rows={6} columns={4} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (
    requiredRole &&
    ROLE_LEVEL[user.role] !== undefined &&
    ROLE_LEVEL[requiredRole] !== undefined &&
    (ROLE_LEVEL[user.role] ?? 0) < (ROLE_LEVEL[requiredRole] ?? 0)
  ) {
    return <ForbiddenState requiredRole={requiredRole} />;
  }

  return <>{children}</>;
}
