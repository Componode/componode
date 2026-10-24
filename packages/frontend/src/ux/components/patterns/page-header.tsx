import type * as React from "react"
import { cn } from "@/ux/lib/utils"

interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** Primary action goes last (right-most). Max one `default` variant button. */
  actions?: React.ReactNode
  /** Leading visual, e.g. a ProviderMark on detail pages. */
  media?: React.ReactNode
  /** Badges / metadata row rendered under the title. */
  meta?: React.ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, media, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 md:flex-row md:items-start md:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-4">
        {media}
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-pretty text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="max-w-2xl text-pretty text-sm text-muted-foreground">{description}</p>}
          {meta && <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Standard page container. Every route renders exactly one. */
export function PageContainer({
  children,
  className,
  width = "default",
}: {
  children: React.ReactNode
  className?: string
  width?: "default" | "narrow" | "full"
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-4 py-6 md:px-8 md:py-8",
        width === "default" && "max-w-7xl",
        width === "narrow" && "max-w-3xl",
        className,
      )}
    >
      {children}
    </div>
  )
}
