import { DescriptionList, RelativeTime } from "@/ux/components/patterns/primitives"
import { Badge } from "@/ux/components/ui/badge"
import { ENVIRONMENT_META } from "@/ux/lib/domain"
import { formatBytes } from "@/ux/lib/format"
import { asObj, bool, hasDefined, num, str, strArr } from "@/ux/lib/guards"
import type { Component, ComponentInstance } from "@/ux/lib/view-types"

// Bounded Docker detail rendering (ADR-121, spec 064): every shaper below
// extracts ONLY the allowlisted keys the importer contract names —
// unknown rawConfig/details keys never render, and there is no generic
// dump anywhere.

// ---- instance rawConfig: dockerObservation (ADR-121 A1, spec 047) ----

interface DockerObservation {
  state?: string
  exitCode?: number
  oomKilled?: boolean
  restarting?: boolean
  startedAt?: string | null
  finishedAt?: string | null
  health?: { status?: string; failingStreak?: number } | null
}

function dockerObservationOf(i: ComponentInstance): DockerObservation | null {
  return asObj<DockerObservation>(i.rawConfig?.dockerObservation)
}

function ObservationDetails({ obs }: { obs: DockerObservation }) {
  const health = obs.health ?? null
  return (
    <DescriptionList
      className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
      items={[
        { label: "Observed state", value: <code className="font-mono text-xs">{obs.state ?? "unknown"}</code> },
        {
          label: "Health check",
          value: health ? (
            <Badge
              variant={health.status === "unhealthy" ? "destructive" : "secondary"}
              className="font-mono"
            >
              {health.status}
              {health.failingStreak ? ` ×${health.failingStreak}` : ""}
            </Badge>
          ) : (
            <span className="text-muted-foreground">No health check configured</span>
          ),
        },
        ...(obs.exitCode !== undefined
          ? [{ label: "Exit code", value: <code className="font-mono text-xs">{obs.exitCode}</code> }]
          : []),
        ...(obs.oomKilled ? [{ label: "OOM killed", value: "Yes" }] : []),
        ...(obs.restarting ? [{ label: "Restarting", value: "Yes" }] : []),
        { label: "Started", value: <RelativeTime iso={obs.startedAt ?? null} /> },
        { label: "Finished", value: <RelativeTime iso={obs.finishedAt ?? null} /> },
      ]}
    />
  )
}

// ---- instance rawConfig: spec 064 additions ----

interface HostConfig {
  memoryBytes?: number
  nanoCpus?: number
  pidsLimit?: number
  restartPolicy?: { mode?: string; maxRetries?: number }
  privileged?: boolean
  readOnlyRootfs?: boolean
  logDriver?: string
}

function hostConfigOf(i: ComponentInstance): HostConfig | null {
  return asObj<HostConfig>(i.rawConfig?.hostConfig)
}

interface HealthcheckDef {
  intervalSeconds?: number
  timeoutSeconds?: number
  retries?: number
  startPeriodSeconds?: number
}

function healthcheckOf(i: ComponentInstance): HealthcheckDef | null {
  return asObj<HealthcheckDef>(i.rawConfig?.healthcheck)
}

interface SwarmObservation {
  mode?: string
  desired?: number
  running?: number
  completed?: number
  updateState?: string
  observedAt?: string
}

function swarmObservationOf(i: ComponentInstance): SwarmObservation | null {
  return asObj<SwarmObservation>(i.rawConfig?.swarmObservation)
}

// Swarm published ports — a DIFFERENT shape from container `ports`
// ({container, published:[…]}), so entries are accepted only when they
// carry the swarm `target` port. Container-shaped entries never render
// here.
interface SwarmPort {
  protocol?: string
  target?: number
  published?: number
  publishMode?: string
}

function swarmPortsOf(i: ComponentInstance): SwarmPort[] {
  const p = i.rawConfig?.ports
  if (!Array.isArray(p)) return []
  return p.filter(
    (e): e is SwarmPort =>
      !!e && typeof e === "object" && typeof (e as SwarmPort).target === "number",
  )
}

function networksOf(i: ComponentInstance): string[] {
  const n = i.rawConfig?.networks
  return Array.isArray(n) ? n.filter((x): x is string => typeof x === "string") : []
}

// Deployed image identity (spec 064 US1): imageRef always present on
// container instances; imageDigest/imageId when the engine reported them.
interface ContainerImage {
  imageRef?: string
  imageDigest?: string
  imageId?: string
}

function containerImageOf(i: ComponentInstance): ContainerImage | null {
  const raw = i.rawConfig
  if (!raw) return null
  const out: ContainerImage = {
    imageRef: str(raw.imageRef),
    imageDigest: str(raw.imageDigest),
    imageId: str(raw.imageId),
  }
  return hasDefined(out) ? out : null
}

// ---- instance rawConfig: githubEnvironment (spec 072) ----
// Deployment-environment governance facts normalized by the GitHub
// importer. protectionRules entries are allowlisted per `type` — unknown
// rule types render their type label only, never raw provider payloads.

interface GithubProtectionRule {
  type?: string
  waitTimerMinutes?: number
  reviewerCount?: number
  preventSelfReview?: boolean
  protectedBranches?: boolean
  customBranchPolicies?: boolean
}

interface GithubBranchPolicy {
  protectedBranches?: boolean
  customBranchPolicies?: boolean
}

interface GithubEnvironment {
  protectionRules?: GithubProtectionRule[]
  deploymentBranchPolicy?: GithubBranchPolicy | null
  canAdminsBypass?: boolean
}

function githubEnvironmentOf(i: ComponentInstance): GithubEnvironment | null {
  const raw = asObj<Record<string, unknown>>(i.rawConfig?.githubEnvironment)
  if (!raw) return null
  const rules = Array.isArray(raw.protectionRules)
    ? raw.protectionRules.flatMap((r) => {
        const o = asObj<Record<string, unknown>>(r)
        const type = o ? str(o.type) : undefined
        if (!o || !type) return []
        const rule: GithubProtectionRule = {
          type,
          waitTimerMinutes: num(o.waitTimerMinutes),
          reviewerCount: num(o.reviewerCount),
          preventSelfReview: bool(o.preventSelfReview),
          protectedBranches: bool(o.protectedBranches),
          customBranchPolicies: bool(o.customBranchPolicies),
        }
        return [rule]
      })
    : undefined
  const dbpRaw = asObj<Record<string, unknown>>(raw.deploymentBranchPolicy)
  const dbp: GithubBranchPolicy | undefined = dbpRaw
    ? {
        protectedBranches: bool(dbpRaw.protectedBranches),
        customBranchPolicies: bool(dbpRaw.customBranchPolicies),
      }
    : undefined
  const out: GithubEnvironment = {
    protectionRules: rules?.length ? rules : undefined,
    deploymentBranchPolicy: dbp && hasDefined(dbp) ? dbp : undefined,
    canAdminsBypass: bool(raw.canAdminsBypass),
  }
  return hasDefined(out) ? out : null
}

export function hasInstanceDetails(i: ComponentInstance): boolean {
  return Boolean(
    dockerObservationOf(i) ||
      containerImageOf(i) ||
      hostConfigOf(i) ||
      healthcheckOf(i) ||
      swarmObservationOf(i) ||
      swarmPortsOf(i).length ||
      networksOf(i).length ||
      githubEnvironmentOf(i),
  )
}

// ---- section components ----

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </section>
  )
}

const secs = (s: number) => `${Math.round(s * 1000) / 1000}s`

function HostConfigDetails({ cfg }: { cfg: HostConfig }) {
  return (
    <DescriptionList
      className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
      items={[
        ...(cfg.memoryBytes !== undefined
          ? [{ label: "Memory limit", value: formatBytes(cfg.memoryBytes) }]
          : []),
        ...(cfg.nanoCpus !== undefined
          ? [{ label: "CPU limit", value: `${cfg.nanoCpus / 1e9} CPUs` }]
          : []),
        ...(cfg.pidsLimit !== undefined
          ? [{ label: "PID limit", value: String(cfg.pidsLimit) }]
          : []),
        ...(cfg.restartPolicy?.mode
          ? [
              {
                label: "Restart policy",
                value: (
                  <code className="font-mono text-xs">
                    {cfg.restartPolicy.mode}
                    {cfg.restartPolicy.maxRetries
                      ? ` (max ${cfg.restartPolicy.maxRetries})`
                      : ""}
                  </code>
                ),
              },
            ]
          : []),
        ...(cfg.privileged ? [{ label: "Privileged", value: "Yes" }] : []),
        ...(cfg.readOnlyRootfs
          ? [{ label: "Read-only rootfs", value: "Yes" }]
          : []),
        ...(cfg.logDriver
          ? [{ label: "Log driver", value: <code className="font-mono text-xs">{cfg.logDriver}</code> }]
          : []),
      ]}
    />
  )
}

function HealthcheckDetails({ hc }: { hc: HealthcheckDef }) {
  return (
    <DescriptionList
      className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
      items={[
        ...(hc.intervalSeconds !== undefined
          ? [{ label: "Interval", value: secs(hc.intervalSeconds) }]
          : []),
        ...(hc.timeoutSeconds !== undefined
          ? [{ label: "Timeout", value: secs(hc.timeoutSeconds) }]
          : []),
        ...(hc.retries !== undefined
          ? [{ label: "Retries", value: String(hc.retries) }]
          : []),
        ...(hc.startPeriodSeconds !== undefined
          ? [{ label: "Start period", value: secs(hc.startPeriodSeconds) }]
          : []),
      ]}
    />
  )
}

function SwarmObservationDetails({ obs }: { obs: SwarmObservation }) {
  return (
    <DescriptionList
      className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
      items={[
        ...(obs.mode
          ? [
              {
                label: "Mode",
                value: <code className="font-mono text-xs">{obs.mode}</code>,
              },
            ]
          : []),
        ...(obs.desired !== undefined
          ? [{ label: "Desired tasks", value: String(obs.desired) }]
          : []),
        ...(obs.running !== undefined
          ? [{ label: "Running tasks", value: String(obs.running) }]
          : []),
        ...(obs.completed !== undefined && obs.completed > 0
          ? [{ label: "Completed tasks", value: String(obs.completed) }]
          : []),
        ...(obs.updateState
          ? [
              {
                label: "Update state",
                value: <code className="font-mono text-xs">{obs.updateState}</code>,
              },
            ]
          : []),
        ...(obs.observedAt
          ? [{ label: "Observed", value: <RelativeTime iso={obs.observedAt} /> }]
          : []),
      ]}
    />
  )
}

function PortsDetails({ ports }: { ports: SwarmPort[] }) {
  return (
    <ul className="space-y-1 font-mono text-xs">
      {ports.map((p, i) => (
        <li key={i}>
          {p.protocol ?? "tcp"} {p.target ?? "?"} →{" "}
          {p.published !== undefined ? p.published : "—"}
          {p.publishMode ? ` (${p.publishMode})` : ""}
        </li>
      ))}
    </ul>
  )
}

function NetworksDetails({ networks }: { networks: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {networks.map((n) => (
        <Badge key={n} variant="secondary" className="font-mono">
          {n}
        </Badge>
      ))}
    </div>
  )
}

function describeProtectionRule(r: GithubProtectionRule) {
  switch (r.type) {
    case "wait_timer":
      return r.waitTimerMinutes !== undefined
        ? `Wait timer — ${r.waitTimerMinutes} min`
        : "Wait timer"
    case "required_reviewers": {
      const parts: string[] = []
      if (r.reviewerCount !== undefined)
        parts.push(
          `${r.reviewerCount} reviewer${r.reviewerCount === 1 ? "" : "s"}`,
        )
      if (r.preventSelfReview !== undefined)
        parts.push(
          r.preventSelfReview ? "self-review prevented" : "self-review allowed",
        )
      return parts.length
        ? `Required reviewers — ${parts.join(", ")}`
        : "Required reviewers"
    }
    case "branch_policy": {
      const parts: string[] = []
      if (r.protectedBranches) parts.push("protected branches")
      if (r.customBranchPolicies) parts.push("custom branch policies")
      return parts.length ? `Branch policy — ${parts.join(", ")}` : "Branch policy"
    }
    default:
      return <code className="font-mono text-xs">{r.type}</code>
  }
}

function describeBranchPolicy(p: GithubBranchPolicy): string {
  const parts: string[] = []
  if (p.protectedBranches) parts.push("protected branches")
  if (p.customBranchPolicies) parts.push("custom branch policies")
  return parts.length ? parts.join(", ") : "No restrictions"
}

function GithubEnvironmentDetails({ env }: { env: GithubEnvironment }) {
  return (
    <div className="space-y-3">
      {env.protectionRules?.length ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Protection rules</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {env.protectionRules.map((r, i) => (
              <li key={i}>{describeProtectionRule(r)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <DescriptionList
        className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
        items={[
          ...(env.deploymentBranchPolicy
            ? [
                {
                  label: "Deployment branch policy",
                  value: describeBranchPolicy(env.deploymentBranchPolicy),
                },
              ]
            : []),
          ...(env.canAdminsBypass !== undefined
            ? [
                {
                  label: "Admins can bypass",
                  value: env.canAdminsBypass ? "Yes" : "No",
                },
              ]
            : []),
        ]}
      />
    </div>
  )
}

function ContainerImageDetails({ img }: { img: ContainerImage }) {
  return (
    <DescriptionList
      className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
      items={[
        ...(img.imageRef
          ? [
              {
                label: "Reference",
                value: <code className="font-mono text-xs">{img.imageRef}</code>,
              },
            ]
          : []),
        ...(img.imageDigest
          ? [
              {
                label: "Digest",
                value: <code className="font-mono text-xs">{img.imageDigest}</code>,
              },
            ]
          : []),
        ...(img.imageId
          ? [
              {
                label: "Image ID",
                value: <code className="font-mono text-xs">{img.imageId}</code>,
              },
            ]
          : []),
      ]}
    />
  )
}

// Renders every known allowlisted block present on the instance — the
// expander's content. Sections appear only for blocks that exist.
export function InstanceDetails({ instance }: { instance: ComponentInstance }) {
  const obs = dockerObservationOf(instance)
  const swarmObs = swarmObservationOf(instance)
  const image = containerImageOf(instance)
  const hostConfig = hostConfigOf(instance)
  const healthcheck = healthcheckOf(instance)
  const ports = swarmPortsOf(instance)
  const networks = networksOf(instance)
  const ghEnv = githubEnvironmentOf(instance)
  return (
    <div className="space-y-4">
      {instance.environmentOverride ? (
        <Section title="Environment">
          <p className="text-sm text-muted-foreground">
            Manually overridden to {ENVIRONMENT_META[instance.environment].label}; the
            importer reports {ENVIRONMENT_META[instance.reportedEnvironment].label}.
          </p>
        </Section>
      ) : null}
      {obs ? (
        <Section title="Observation">
          <ObservationDetails obs={obs} />
        </Section>
      ) : null}
      {swarmObs ? (
        <Section title="Observation">
          <SwarmObservationDetails obs={swarmObs} />
        </Section>
      ) : null}
      {image ? (
        <Section title="Image">
          <ContainerImageDetails img={image} />
        </Section>
      ) : null}
      {hostConfig ? (
        <Section title="Host config">
          <HostConfigDetails cfg={hostConfig} />
        </Section>
      ) : null}
      {healthcheck ? (
        <Section title="Health check definition">
          <HealthcheckDetails hc={healthcheck} />
        </Section>
      ) : null}
      {ports.length ? (
        <Section title="Ports">
          <PortsDetails ports={ports} />
        </Section>
      ) : null}
      {networks.length ? (
        <Section title="Networks">
          <NetworksDetails networks={networks} />
        </Section>
      ) : null}
      {ghEnv ? (
        <Section title="GitHub environment">
          <GithubEnvironmentDetails env={ghEnv} />
        </Section>
      ) : null}
    </div>
  )
}

// ---- component details: resourceType-keyed sections (spec 064) ----

interface EngineDetails {
  serverVersion?: string
  apiVersion?: string
  os?: string
  arch?: string
  kernelVersion?: string
  cgroupDriver?: string
  runtimes?: string[]
  registryMirrors?: string[]
  swarmNodeState?: string
  swarmControlAvailable?: boolean
  swarmManagers?: number
}

const strRecord = (v: unknown) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
  const out = Object.fromEntries(
    Object.entries(v as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  )
  return Object.keys(out).length ? out : undefined
}

function engineDetailsOf(details: Component["details"]): EngineDetails | null {
  const d = asObj<Record<string, unknown>>(details)
  if (!d) return null
  const out: EngineDetails = {
    serverVersion: str(d.serverVersion),
    apiVersion: str(d.apiVersion),
    os: str(d.os),
    arch: str(d.arch),
    kernelVersion: str(d.kernelVersion),
    cgroupDriver: str(d.cgroupDriver),
    runtimes: strArr(d.runtimes),
    registryMirrors: strArr(d.registryMirrors),
    swarmNodeState: str(d.swarmNodeState),
    swarmControlAvailable:
      typeof d.swarmControlAvailable === "boolean" ? d.swarmControlAvailable : undefined,
    swarmManagers: typeof d.swarmManagers === "number" ? d.swarmManagers : undefined,
  }
  return hasDefined(out) ? out : null
}

export function EngineDetailsSection({ details }: { details: Component["details"] }) {
  const e = engineDetailsOf(details)
  if (!e) return null
  return (
    <Section title="Engine">
      <DescriptionList
        className="sm:grid-cols-1"
        items={[
          ...(e.serverVersion ? [{ label: "Server version", value: e.serverVersion }] : []),
          ...(e.apiVersion ? [{ label: "API version", value: e.apiVersion }] : []),
          ...(e.os ? [{ label: "OS", value: e.os }] : []),
          ...(e.arch ? [{ label: "Architecture", value: e.arch }] : []),
          ...(e.kernelVersion ? [{ label: "Kernel", value: e.kernelVersion }] : []),
          ...(e.cgroupDriver ? [{ label: "Cgroup driver", value: e.cgroupDriver }] : []),
          ...(e.runtimes?.length
            ? [{ label: "Runtimes", value: e.runtimes.join(", ") }]
            : []),
          ...(e.registryMirrors?.length
            ? [{ label: "Registry mirrors", value: e.registryMirrors.join(", ") }]
            : []),
          ...(e.swarmNodeState
            ? [{ label: "Swarm node state", value: e.swarmNodeState }]
            : []),
          ...(e.swarmControlAvailable !== undefined
            ? [{ label: "Swarm control available", value: e.swarmControlAvailable ? "Yes" : "No" }]
            : []),
          ...(e.swarmManagers !== undefined
            ? [{ label: "Swarm managers", value: String(e.swarmManagers) }]
            : []),
        ]}
      />
    </Section>
  )
}

interface ImageDetails {
  ociLabels?: Record<string, string>
  exposedPorts?: string[]
  user?: string
  entrypoint?: string[]
  workingDir?: string
  volumes?: string[]
  architecture?: string
  os?: string
}

function imageDetailsOf(details: Component["details"]): ImageDetails | null {
  const d = asObj<Record<string, unknown>>(details)
  if (!d) return null
  const out: ImageDetails = {
    ociLabels: strRecord(d.ociLabels),
    exposedPorts: strArr(d.exposedPorts),
    user: str(d.user),
    entrypoint: strArr(d.entrypoint),
    workingDir: str(d.workingDir),
    volumes: strArr(d.volumes),
    architecture: str(d.architecture),
    os: str(d.os),
  }
  return hasDefined(out) ? out : null
}

export function ImageDetailsSection({ details }: { details: Component["details"] }) {
  const img = imageDetailsOf(details)
  if (!img) return null
  return (
    <Section title="Image provenance">
      <div className="space-y-3">
        <DescriptionList
          className="sm:grid-cols-1"
          items={[
            ...(img.architecture ? [{ label: "Architecture", value: img.architecture }] : []),
            ...(img.os ? [{ label: "OS", value: img.os }] : []),
            ...(img.user ? [{ label: "User", value: img.user }] : []),
            ...(img.workingDir ? [{ label: "Working dir", value: img.workingDir }] : []),
            ...(img.entrypoint?.length
              ? [{ label: "Entrypoint", value: <code className="font-mono text-xs">{img.entrypoint.join(" ")}</code> }]
              : []),
          ]}
        />
        {img.exposedPorts?.length || img.volumes?.length ? (
          <div className="flex flex-wrap gap-3">
            {img.exposedPorts?.length ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Exposed ports</p>
                <div className="flex flex-wrap gap-1">
                  {img.exposedPorts.map((p) => (
                    <Badge key={p} variant="secondary" className="font-mono">
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {img.volumes?.length ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Volumes</p>
                <div className="flex flex-wrap gap-1">
                  {img.volumes.map((v) => (
                    <Badge key={v} variant="secondary" className="font-mono">
                      {v}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {img.ociLabels ? <LabelPairs labels={img.ociLabels} /> : null}
      </div>
    </Section>
  )
}

function LabelPairs({ labels }: { labels: Record<string, string> }) {
  return (
    <DescriptionList
      className="sm:grid-cols-[minmax(14rem,auto)_1fr]"
      items={Object.entries(labels).map(([k, v]) => ({
        label: k,
        value: <code className="font-mono text-xs">{v}</code>,
      }))}
    />
  )
}

// ---- component details: infra inventory sections (spec 065) ----

interface NetworkDetails {
  driver?: string
  scope?: string
  createdAt?: string
  internal?: boolean
  attachable?: boolean
  ingress?: boolean
  configOnly?: boolean
  enableIPv6?: boolean
  attachedCount?: number
  attachedContainers?: string[]
  labels?: Record<string, string>
}

function networkDetailsOf(details: Component["details"]): NetworkDetails | null {
  const d = asObj<Record<string, unknown>>(details)
  if (!d) return null
  const flag = (v: unknown) => (v === true ? true : undefined)
  const out: NetworkDetails = {
    driver: str(d.driver),
    scope: str(d.scope),
    createdAt: str(d.createdAt),
    internal: flag(d.internal),
    attachable: flag(d.attachable),
    ingress: flag(d.ingress),
    configOnly: flag(d.configOnly),
    enableIPv6: flag(d.enableIPv6),
    attachedCount: typeof d.attachedCount === "number" ? d.attachedCount : undefined,
    attachedContainers: strArr(d.attachedContainers),
    labels: strRecord(d.labels),
  }
  return hasDefined(out) ? out : null
}

export function NetworkDetailsSection({ details }: { details: Component["details"] }) {
  const n = networkDetailsOf(details)
  if (!n) return null
  return (
    <Section title="Network">
      <div className="space-y-3">
        <DescriptionList
          className="sm:grid-cols-1"
          items={[
            ...(n.driver
              ? [{ label: "Driver", value: <code className="font-mono text-xs">{n.driver}</code> }]
              : []),
            ...(n.scope ? [{ label: "Scope", value: n.scope }] : []),
            ...(n.createdAt
              ? [{ label: "Created", value: <RelativeTime iso={n.createdAt} /> }]
              : []),
            ...(n.internal ? [{ label: "Internal", value: "Yes" }] : []),
            ...(n.attachable ? [{ label: "Attachable", value: "Yes" }] : []),
            ...(n.ingress ? [{ label: "Ingress", value: "Yes" }] : []),
            ...(n.configOnly ? [{ label: "Config only", value: "Yes" }] : []),
            ...(n.enableIPv6 ? [{ label: "IPv6", value: "Yes" }] : []),
            ...(n.attachedCount !== undefined
              ? [{ label: "Attached", value: String(n.attachedCount) }]
              : []),
          ]}
        />
        {n.attachedContainers?.length ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Attached containers</p>
            <div className="flex flex-wrap gap-1">
              {n.attachedContainers.map((name) => (
                <Badge key={name} variant="secondary" className="font-mono">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {n.labels ? <LabelPairs labels={n.labels} /> : null}
      </div>
    </Section>
  )
}

interface VolumeDetails {
  driver?: string
  scope?: string
  createdAt?: string
  sizeBytes?: number
  refCount?: number
  reclaimable?: boolean
  labels?: Record<string, string>
}

function volumeDetailsOf(details: Component["details"]): VolumeDetails | null {
  const d = asObj<Record<string, unknown>>(details)
  if (!d) return null
  const out: VolumeDetails = {
    driver: str(d.driver),
    scope: str(d.scope),
    createdAt: str(d.createdAt),
    sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : undefined,
    refCount: typeof d.refCount === "number" ? d.refCount : undefined,
    reclaimable: typeof d.reclaimable === "boolean" ? d.reclaimable : undefined,
    labels: strRecord(d.labels),
  }
  return hasDefined(out) ? out : null
}

export function VolumeDetailsSection({ details }: { details: Component["details"] }) {
  const v = volumeDetailsOf(details)
  if (!v) return null
  return (
    <Section title="Volume">
      <div className="space-y-3">
        <DescriptionList
          className="sm:grid-cols-1"
          items={[
            ...(v.driver
              ? [{ label: "Driver", value: <code className="font-mono text-xs">{v.driver}</code> }]
              : []),
            ...(v.scope ? [{ label: "Scope", value: v.scope }] : []),
            ...(v.createdAt
              ? [{ label: "Created", value: <RelativeTime iso={v.createdAt} /> }]
              : []),
            ...(v.sizeBytes !== undefined
              ? [{ label: "Size", value: formatBytes(v.sizeBytes) }]
              : []),
            ...(v.refCount !== undefined
              ? [{ label: "References", value: String(v.refCount) }]
              : []),
            ...(v.reclaimable !== undefined
              ? [{ label: "Reclaimable", value: v.reclaimable ? "Yes" : "No" }]
              : []),
          ]}
        />
        {v.labels ? <LabelPairs labels={v.labels} /> : null}
      </div>
    </Section>
  )
}
