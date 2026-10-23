import { Badge } from "@/ux/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ux/components/ui/tooltip"
import {
  AGENT_CREDENTIAL_META,
  AGENT_STATUS_META,
  type AgentCredentialState,
  type AgentStatus,
  CREDENTIAL_STATUS_META,
  CRITICALITY_META,
  type Criticality,
  type CredentialStatus,
  ENVIRONMENT_META,
  type Environment,
  HEALTH_META,
  type InstanceStatus,
  LIFECYCLE_META,
  type Lifecycle,
  PRODUCT_TYPE_META,
  type ProductType,
  ROLE_META,
  type Role,
  RUN_STATUS_META,
  type RunStatus,
  type Tone,
} from "@/ux/lib/domain"
import { cn } from "@/ux/lib/utils"

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  brand: "bg-primary",
}

interface StatusBadgeProps {
  tone: Tone
  label: string
  description?: string
  pulse?: boolean
  className?: string
}

/**
 * The only way to render an enum value. Colour is never the sole signal: every badge
 * pairs a tone dot with a text label, and the description is exposed as a tooltip.
 */
export function StatusBadge({ tone, label, description, pulse, className }: StatusBadgeProps) {
  const badge = (
    <Badge variant="outline" className={cn("gap-1.5 font-medium text-foreground/90", className)}>
      <span className="relative flex size-1.5" aria-hidden="true">
        {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", DOT[tone])} />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", DOT[tone])} />
      </span>
      {label}
    </Badge>
  )
  if (!description) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  )
}

export function CriticalityBadge({ value }: { value: Criticality | null }) {
  if (!value) return <span className="text-sm text-muted-foreground">—</span>
  return <StatusBadge {...CRITICALITY_META[value]} />
}
export const LifecycleBadge = ({ value }: { value: Lifecycle }) => <StatusBadge {...LIFECYCLE_META[value]} />
export function HealthBadge({ value }: { value: InstanceStatus | null }) {
  if (!value) return <span className="text-sm text-muted-foreground">No data</span>
  return <StatusBadge {...HEALTH_META[value]} />
}
export const EnvironmentBadge = ({ value }: { value: Environment }) => <StatusBadge {...ENVIRONMENT_META[value]} />
export const RunStatusBadge = ({ value }: { value: RunStatus }) => (
  <StatusBadge {...RUN_STATUS_META[value]} pulse={value === "RUNNING"} />
)
export const CredentialStatusBadge = ({ value }: { value: CredentialStatus }) => (
  <StatusBadge {...CREDENTIAL_STATUS_META[value]} />
)
export const AgentStatusBadge = ({ value }: { value: AgentStatus }) => (
  <StatusBadge {...AGENT_STATUS_META[value]} pulse={value === "CONNECTED"} />
)
export const AgentCredentialBadge = ({ value }: { value: AgentCredentialState }) => (
  <StatusBadge {...AGENT_CREDENTIAL_META[value]} />
)
export const RoleBadge = ({ value }: { value: Role }) => <StatusBadge {...ROLE_META[value]} />
export function ProductTypeBadge({ value }: { value: ProductType }) {
  const meta = PRODUCT_TYPE_META[value]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary">{meta.label}</Badge>
      </TooltipTrigger>
      <TooltipContent>{meta.description}</TooltipContent>
    </Tooltip>
  )
}
