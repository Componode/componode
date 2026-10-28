import * as React from "react"
import { Navigate } from "react-router-dom"
import { useSession as useAuthSession } from "@/api/hooks/auth"
import { Spinner } from "@/ux/components/ui/spinner"
import type { User } from "@/ux/lib/view-types"

interface SessionValue {
  user: User
}

const SessionContext = React.createContext<SessionValue | null>(null)

/**
 * Real-session adapter for the staged UX shell. The prototype's SessionProvider
 * carried a role-switcher stub; the staging tree renders inside AuthGuard, so
 * an authenticated api user is always present here.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useAuthSession()
  const value = React.useMemo<SessionValue | null>(() => {
    if (!data) return null
    return {
      user: {
        id: data.id,
        username: data.username,
        displayName: data.displayName,
        email: data.email,
        role: data.role,
        isActive: data.isActive,
        lastActiveAt: null,
        createdAt: data.createdAt,
      },
    }
  }, [data])
  if (!value) {
    if (isPending) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Spinner />
        </div>
      )
    }
    // Redirect only on a resolved-null session (AUTH_NO_SESSION → null by
    // design); a query error renders the provider and lets AuthGuard decide.
    if (data === null) return <Navigate to="/login" replace />
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = React.useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>")
  return ctx
}
