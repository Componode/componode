import { cn } from "@/ux/lib/utils"

/** Componode mark: three connected nodes — products composed of components. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground", className)}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[60%]">
        <circle cx="6" cy="7" r="2.6" fill="currentColor" />
        <circle cx="18" cy="7" r="2.6" fill="currentColor" opacity="0.7" />
        <circle cx="12" cy="17.5" r="2.6" fill="currentColor" />
        <path d="M7.6 9 10.6 15M16.4 9 13.4 15M8.6 7h6.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function Logo({ className, withProduct = true }: { className?: string; withProduct?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight">Componode</span>
        {withProduct && <span className="mt-0.5 text-[11px] text-muted-foreground">Digital Product Asset Mgmt</span>}
      </span>
    </span>
  )
}
