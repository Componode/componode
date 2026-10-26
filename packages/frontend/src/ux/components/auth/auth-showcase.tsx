import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { HealthBadge, EnvironmentBadge } from "@/ux/components/patterns/status-badge"
import type { Environment, InstanceStatus, Provider } from "@/ux/lib/domain"

const ROWS: { name: string; provider: Provider; env: Environment; status: InstanceStatus }[] = [
  { name: "payments-api", provider: "KUBERNETES", env: "PRODUCTION", status: "RUNNING" },
  { name: "payments-ledger-db", provider: "AWS", env: "PRODUCTION", status: "RUNNING" },
  { name: "checkout-web", provider: "AZURE", env: "PRODUCTION", status: "ERROR" },
  { name: "halcyon-checkout", provider: "GITHUB", env: "OTHER", status: "RUNNING" },
]

/** Right-hand panel on auth screens: shows what the product does instead of stock art. */
export function AuthShowcase() {
  return (
    <aside className="relative hidden overflow-hidden border-l bg-muted/40 lg:flex lg:flex-col lg:justify-center lg:gap-10 lg:px-16" aria-hidden="true">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="relative flex max-w-lg flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Digital product asset management</p>
        <h2 className="text-balance text-3xl font-semibold tracking-tight">
          Every product. Every component. One trustworthy map.
        </h2>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          Componode imports your cloud, cluster and repository assets, then lets you curate them into the products your
          organization actually ships.
        </p>
      </div>

      <div className="relative flex max-w-lg flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Payments Platform</span>
            <span className="text-xs text-muted-foreground">Platform · Commerce · Payments Core</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">24 components</span>
        </div>
        <ul className="flex flex-col divide-y">
          {ROWS.map((row) => (
            <li key={row.name} className="flex items-center gap-3 px-4 py-2.5">
              <ProviderMark provider={row.provider} size="sm" />
              <span className="flex-1 truncate font-mono text-xs">{row.name}</span>
              <EnvironmentBadge value={row.env} />
              <HealthBadge value={row.status} />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
