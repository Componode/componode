import * as React from "react"
import { useSession as useAuthSession } from "@/api/hooks/auth"
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
  const { data } = useAuthSession()
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
  if (!value) return null
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = React.useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>")
  return ctx
}
