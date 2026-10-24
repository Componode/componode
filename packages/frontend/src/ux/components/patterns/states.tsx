import { AlertTriangleIcon, LockIcon, type LucideIcon, RefreshCwIcon, SearchXIcon } from "lucide-react"
import { Link } from "react-router-dom"
import type * as React from "react"
import { Button } from "@/ux/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ux/components/ui/empty"
import { Skeleton } from "@/ux/components/ui/skeleton"
import { cn } from "@/ux/lib/utils"

interface StateProps {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

/** First-run / nothing-here-yet. Always offer the next step when the user can take it. */
export function EmptyState({ icon: Icon = SearchXIcon, title, description, action, className }: StateProps) {
  return (
    <Empty className={cn("border border-dashed", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

/** Query failed. Never show raw stack traces; offer retry + a request id for support. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn’t load this data. Check your connection and try again.",
  requestId,
  onRetry,
  className,
}: Partial<StateProps> & { requestId?: string; onRetry?: () => void }) {
  return (
    <Empty className={cn("border border-dashed border-destructive/30", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
          <AlertTriangleIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry}>
          <RefreshCwIcon data-icon="inline-start" />
          Try again
        </Button>
        {requestId && <p className="font-mono text-xs text-muted-foreground">Request ID {requestId}</p>}
      </EmptyContent>
    </Empty>
  )
}

/** 403 surface. Explain who can grant access instead of a dead end. */
export function ForbiddenState({ requiredRole = "Admin", className }: { requiredRole?: string; className?: string }) {
  return (
    <Empty className={cn("border border-dashed", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockIcon />
        </EmptyMedia>
        <EmptyTitle>You don&apos;t have access to this page</EmptyTitle>
        <EmptyDescription>
          This area requires the {requiredRole} role. Ask a workspace admin to update your role.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/** 404 surface. Point back to the list the entity belongs to. */
export function NotFoundState({
  title = "Not found",
  description = "This record doesn't exist or was deleted.",
  backHref,
  backLabel = "Back to list",
  className,
}: { backHref?: string; backLabel?: string } & Partial<StateProps>) {
  return (
    <Empty className={cn("border border-dashed", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {backHref && (
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link to={backHref}>{backLabel}</Link>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

/** Mirrors the real table's column count so the layout doesn't jump when data arrives. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  )
}
