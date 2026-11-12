import { DescriptionList, RelativeTime } from "@/ux/components/patterns/primitives"
import { ExternalLink } from "@/ux/components/patterns/external-link"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Badge } from "@/ux/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ux/components/ui/table"
import { formatNumber } from "@/ux/lib/format"
import type { Component } from "@/ux/lib/view-types"

// Bounded GitHub detail rendering (ADR-121, spec 072): every shaper below
// extracts ONLY the allowlisted keys the importer contract names
// (contracts/github-inventory.md) — unknown details keys never render, and
// there is no generic dump anywhere. All outbound hrefs go through
// ExternalLink → safeUrl (ADR-085).

const asObj = <T,>(v: unknown): T | null =>
  v && typeof v === "object" ? (v as T) : null

const hasDefined = (o: object) =>
  Object.values(o).some((v) => v !== undefined)

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined)

const strArr = (v: unknown) => {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0)
  return out.length ? out : undefined
}

// ---- component details: github:repository (spec 072) ----

interface ForkRef {
  fullName?: string
  htmlUrl?: string
}

interface LicenseRef {
  key?: string
  name?: string
  spdxId?: string
}

interface RepoFacts {
  defaultBranch?: string
  archived?: boolean
  disabled?: boolean
  fork?: boolean
  forkParent?: ForkRef
  forkSource?: ForkRef
  sizeKb?: number
  license?: LicenseRef
  openIssuesCount?: number
  createdAt?: string
  pushedAt?: string
  updatedAt?: string
  // pre-existing details keys (unchanged by spec 072)
  language?: string
  topics?: string[]
  visibility?: string
  htmlUrl?: string
}

interface BranchEntry {
  name: string
  sha?: string
  url?: string
  protected?: boolean
  isDefault?: boolean
  lastActivityAt?: string
}

interface ReleaseEntry {
  tagName: string
  name?: string
  publishedAt?: string
  prerelease?: boolean
  draft?: boolean
  targetCommitish?: string
  assetCount?: number
  assetsTotalBytes?: number
  htmlUrl?: string
}

interface TagEntry {
  name: string
  sha?: string
  htmlUrl?: string
}

interface DegradedCapability {
  key: string
  label: string
  status: string
  message?: string
}

const forkRefOf = (v: unknown): ForkRef | undefined => {
  const o = asObj<Record<string, unknown>>(v)
  if (!o) return undefined
  const out: ForkRef = { fullName: str(o.fullName), htmlUrl: str(o.htmlUrl) }
  return hasDefined(out) ? out : undefined
}

const licenseOf = (v: unknown): LicenseRef | undefined => {
  const o = asObj<Record<string, unknown>>(v)
  if (!o) return undefined
  const out: LicenseRef = {
    key: str(o.key),
    name: str(o.name),
    spdxId: str(o.spdxId),
  }
  return hasDefined(out) ? out : undefined
}

function repoFactsOf(details: Component["details"]): RepoFacts | null {
  const d = asObj<Record<string, unknown>>(details)
  if (!d) return null
  const out: RepoFacts = {
    defaultBranch: str(d.defaultBranch),
    archived: bool(d.archived),
    disabled: bool(d.disabled),
    fork: bool(d.fork),
    forkParent: forkRefOf(d.forkParent),
    forkSource: forkRefOf(d.forkSource),
    sizeKb: num(d.sizeKb),
    license: licenseOf(d.license),
    openIssuesCount: num(d.openIssuesCount),
    createdAt: str(d.createdAt),
    pushedAt: str(d.pushedAt),
    updatedAt: str(d.updatedAt),
    language: str(d.language),
    topics: strArr(d.topics),
    visibility: str(d.visibility),
    htmlUrl: str(d.htmlUrl),
  }
  return hasDefined(out) ? out : null
}

function branchesOf(details: Component["details"]): BranchEntry[] {
  const d = asObj<Record<string, unknown>>(details)
  const arr = d?.branches
  if (!Array.isArray(arr)) return []
  return arr.flatMap((e) => {
    const o = asObj<Record<string, unknown>>(e)
    const name = o ? str(o.name) : undefined
    if (!o || !name) return []
    return [
      {
        name,
        sha: str(o.sha),
        url: str(o.url),
        protected: bool(o.protected),
        isDefault: bool(o.isDefault),
        lastActivityAt: str(o.lastActivityAt),
      },
    ]
  })
}

function releasesOf(details: Component["details"]): ReleaseEntry[] {
  const d = asObj<Record<string, unknown>>(details)
  const arr = d?.releases
  if (!Array.isArray(arr)) return []
  return arr.flatMap((e) => {
    const o = asObj<Record<string, unknown>>(e)
    const tagName = o ? str(o.tagName) : undefined
    if (!o || !tagName) return []
    return [
      {
        tagName,
        name: str(o.name),
        publishedAt: str(o.publishedAt),
        prerelease: bool(o.prerelease),
        draft: bool(o.draft),
        targetCommitish: str(o.targetCommitish),
        assetCount: num(o.assetCount),
        assetsTotalBytes: num(o.assetsTotalBytes),
        htmlUrl: str(o.htmlUrl),
      },
    ]
  })
}

function tagsOf(details: Component["details"]): TagEntry[] {
  const d = asObj<Record<string, unknown>>(details)
  const arr = d?.tags
  if (!Array.isArray(arr)) return []
  return arr.flatMap((e) => {
    const o = asObj<Record<string, unknown>>(e)
    const name = o ? str(o.name) : undefined
    if (!o || !name) return []
    return [{ name, sha: str(o.sha), htmlUrl: str(o.htmlUrl) }]
  })
}

function languagesOf(details: Component["details"]): [string, number][] {
  const d = asObj<Record<string, unknown>>(details)
  const lang = asObj<Record<string, unknown>>(d?.languages)
  if (!lang) return []
  return Object.entries(lang).flatMap(([k, v]) =>
    typeof v === "number" && Number.isFinite(v) ? [[k, v] as [string, number]] : [],
  )
}

// Per-repo degradation markers (contract §2/§5): only non-OK families
// surface — an all-OK capabilities map renders nothing.
const CAPABILITY_LABELS: Record<string, string> = {
  branches: "Branch inventory",
  branchInstances: "Branch instances",
  branchActivity: "Branch activity",
  versionInventory: "Version inventory",
  languages: "Language breakdown",
  environments: "Environments",
  deployments: "Deployments",
}

function degradedCapabilitiesOf(
  details: Component["details"],
): DegradedCapability[] {
  const d = asObj<Record<string, unknown>>(details)
  const caps = asObj<Record<string, unknown>>(d?.capabilities)
  if (!caps) return []
  return Object.entries(caps).flatMap(([key, v]) => {
    const m = asObj<Record<string, unknown>>(v)
    const status = m ? str(m.status) : undefined
    if (!status || status === "OK") return []
    return [
      {
        key,
        label: CAPABILITY_LABELS[key] ?? key,
        status,
        message: m ? str(m.message) : undefined,
      },
    ]
  })
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

const formatBytes = (n: number) => {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let v = n
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u += 1
  }
  return `${u === 0 ? v : v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`
}

const shortSha = (sha: string) => sha.slice(0, 7)

function ForkRefLink({ fork }: { fork: ForkRef }) {
  if (!fork.htmlUrl) {
    return <code className="font-mono text-xs">{fork.fullName ?? "—"}</code>
  }
  return (
    <ExternalLink
      href={fork.htmlUrl}
      className="font-mono text-xs text-primary hover:underline"
    >
      {fork.fullName ?? fork.htmlUrl}
    </ExternalLink>
  )
}

function RepoSection({ facts }: { facts: RepoFacts }) {
  const licenseLabel = facts.license
    ? (facts.license.name ?? facts.license.spdxId ?? facts.license.key)
    : undefined
  const items = [
    ...(facts.htmlUrl
      ? [
          {
            label: "On GitHub",
            value: (
              <ExternalLink
                href={facts.htmlUrl}
                className="font-mono text-xs break-all"
              >
                {facts.htmlUrl}
              </ExternalLink>
            ),
          },
        ]
      : []),
    ...(facts.defaultBranch
      ? [
          {
            label: "Default branch",
            value: (
              <code className="font-mono text-xs">{facts.defaultBranch}</code>
            ),
          },
        ]
      : []),
    ...(facts.language ? [{ label: "Language", value: facts.language }] : []),
    ...(facts.visibility
      ? [
          {
            label: "Visibility",
            value: (
              <code className="font-mono text-xs">{facts.visibility}</code>
            ),
          },
        ]
      : []),
    ...(facts.topics?.length
      ? [
          {
            label: "Topics",
            value: (
              <div className="flex flex-wrap gap-1">
                {facts.topics.map((t) => (
                  <Badge key={t} variant="secondary" className="font-mono">
                    {t}
                  </Badge>
                ))}
              </div>
            ),
          },
        ]
      : []),
    ...(facts.archived === true ? [{ label: "Archived", value: "Yes" }] : []),
    ...(facts.disabled === true ? [{ label: "Disabled", value: "Yes" }] : []),
    ...(facts.fork === true ? [{ label: "Fork", value: "Yes" }] : []),
    ...(facts.forkParent
      ? [{ label: "Fork parent", value: <ForkRefLink fork={facts.forkParent} /> }]
      : []),
    ...(facts.forkSource
      ? [{ label: "Fork source", value: <ForkRefLink fork={facts.forkSource} /> }]
      : []),
    ...(facts.sizeKb !== undefined
      ? [{ label: "Size", value: formatBytes(facts.sizeKb * 1024) }]
      : []),
    ...(licenseLabel ? [{ label: "License", value: licenseLabel }] : []),
    ...(facts.openIssuesCount !== undefined
      ? [{ label: "Open issues", value: formatNumber(facts.openIssuesCount) }]
      : []),
    ...(facts.createdAt
      ? [{ label: "Created", value: <RelativeTime iso={facts.createdAt} /> }]
      : []),
    ...(facts.pushedAt
      ? [{ label: "Pushed", value: <RelativeTime iso={facts.pushedAt} /> }]
      : []),
    ...(facts.updatedAt
      ? [{ label: "Updated", value: <RelativeTime iso={facts.updatedAt} /> }]
      : []),
  ]
  if (!items.length) return null
  return (
    <Section title="Repository">
      <DescriptionList
        className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
        items={items}
      />
    </Section>
  )
}

function BranchesSection({ branches }: { branches: BranchEntry[] }) {
  if (!branches.length) return null
  const showActivity = branches.some((b) => b.lastActivityAt)
  return (
    <Section title="Branches">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Branch</TableHead>
            <TableHead>HEAD</TableHead>
            {showActivity ? <TableHead>Last activity</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((b) => (
            <TableRow key={b.name}>
              <TableCell>
                <span className="inline-flex items-center gap-1.5">
                  {b.url ? (
                    <ExternalLink
                      href={b.url}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {b.name}
                    </ExternalLink>
                  ) : (
                    <code className="font-mono text-xs">{b.name}</code>
                  )}
                  {b.isDefault ? <Badge variant="secondary">default</Badge> : null}
                  {b.protected ? <Badge variant="outline">protected</Badge> : null}
                </span>
              </TableCell>
              <TableCell>
                {b.sha ? (
                  <code className="font-mono text-xs">{shortSha(b.sha)}</code>
                ) : (
                  "—"
                )}
              </TableCell>
              {showActivity ? (
                <TableCell>
                  <RelativeTime iso={b.lastActivityAt ?? null} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  )
}

const assetsLabel = (r: ReleaseEntry) => {
  const parts: string[] = []
  if (r.assetCount !== undefined)
    parts.push(
      `${formatNumber(r.assetCount)} asset${r.assetCount === 1 ? "" : "s"}`,
    )
  if (r.assetsTotalBytes !== undefined) parts.push(formatBytes(r.assetsTotalBytes))
  return parts.length ? parts.join(" · ") : "—"
}

function ReleasesSection({ releases }: { releases: ReleaseEntry[] }) {
  if (!releases.length) return null
  return (
    <Section title="Releases">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Release</TableHead>
            <TableHead>Published</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Assets</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {releases.map((r, i) => (
            <TableRow key={`${r.tagName}:${i}`}>
              <TableCell>
                <span className="inline-flex items-center gap-1.5">
                  {r.htmlUrl ? (
                    <ExternalLink
                      href={r.htmlUrl}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {r.tagName}
                    </ExternalLink>
                  ) : (
                    <code className="font-mono text-xs">{r.tagName}</code>
                  )}
                  {r.name && r.name !== r.tagName ? (
                    <span className="text-muted-foreground">{r.name}</span>
                  ) : null}
                  {r.prerelease ? (
                    <Badge variant="secondary">prerelease</Badge>
                  ) : null}
                  {r.draft ? <Badge variant="outline">draft</Badge> : null}
                </span>
              </TableCell>
              <TableCell>
                <RelativeTime iso={r.publishedAt ?? null} />
              </TableCell>
              <TableCell>
                {r.targetCommitish ? (
                  <code className="font-mono text-xs">{r.targetCommitish}</code>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>{assetsLabel(r)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  )
}

function TagsSection({ tags }: { tags: TagEntry[] }) {
  if (!tags.length) return null
  return (
    <Section title="Tags">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Tag</TableHead>
            <TableHead>Commit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tags.map((t) => (
            <TableRow key={t.name}>
              <TableCell>
                {t.htmlUrl ? (
                  <ExternalLink
                    href={t.htmlUrl}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {t.name}
                  </ExternalLink>
                ) : (
                  <code className="font-mono text-xs">{t.name}</code>
                )}
              </TableCell>
              <TableCell>
                {t.sha ? (
                  <code className="font-mono text-xs">{shortSha(t.sha)}</code>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  )
}

function LanguagesSection({ languages }: { languages: [string, number][] }) {
  if (!languages.length) return null
  return (
    <Section title="Languages">
      <DescriptionList
        className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
        items={languages.map(([lang, bytes]) => ({
          label: lang,
          value: formatBytes(bytes),
        }))}
      />
    </Section>
  )
}

function CapabilityNotice({ items }: { items: DegradedCapability[] }) {
  return (
    <Alert>
      <AlertTitle>Some GitHub inventory data is incomplete</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-0.5 pl-4">
          {items.map((c) => (
            <li key={c.key}>
              {c.label} (<code className="font-mono text-xs">{c.status}</code>)
              {c.message ? ` — ${c.message}` : ""}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

/**
 * GitHub repository inventory + metadata (spec 072). Renders only for
 * `resourceType === "github:repository"` — wired in component-detail.tsx.
 * Every subsection appears only when its allowlisted payload keys exist.
 */
export function GithubDetailsSection({
  details,
}: {
  details: Component["details"]
}) {
  const facts = repoFactsOf(details)
  const branches = branchesOf(details)
  const releases = releasesOf(details)
  const tags = tagsOf(details)
  const languages = languagesOf(details)
  const degraded = degradedCapabilitiesOf(details)
  if (
    !facts &&
    !branches.length &&
    !releases.length &&
    !tags.length &&
    !languages.length &&
    !degraded.length
  ) {
    return null
  }
  return (
    <div className="space-y-6">
      {degraded.length ? <CapabilityNotice items={degraded} /> : null}
      {facts ? <RepoSection facts={facts} /> : null}
      <BranchesSection branches={branches} />
      <ReleasesSection releases={releases} />
      <TagsSection tags={tags} />
      <LanguagesSection languages={languages} />
    </div>
  )
}
