import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, PlusIcon, XIcon } from "lucide-react"
import { uuidv7 } from "uuidv7"
import {
  ENVIRONMENTS,
  ENVIRONMENT_META,
  URL_CHECK_AUTO_DISABLE_AFTER_MAX,
  URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT,
  URL_CHECK_MAX_CADENCE_SECONDS,
  URL_CHECK_MIN_CADENCE_SECONDS,
  type CollectionScope,
  type SuccessPolicy,
} from "@componode/core"
import {
  parseStatusesInput,
  statusesInputOf,
  urlCheckAuthConfigOf,
  validateUrlCheckDraft,
} from "@/api/mappers/monitoring"
import { Button } from "@/ux/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Switch } from "@/ux/components/ui/switch"
import { cn } from "@/ux/lib/utils"
import type { UrlCheckAuthMode, UrlCheckMethod } from "@/ux/lib/domain"
import { UrlCheckAuthFields, type HeaderRow } from "../catalog/url-check-auth-fields"

export interface ManagedCheckDraft {
  checkKey: string
  name: string
  /** Optional check-URL override; empty = the instance URL. */
  url: string
  method: UrlCheckMethod
  enabled: boolean
  /** Accepted-statuses input, e.g. "200-299,301" — parsed on submit. */
  statuses: string
  /** Cadence override in seconds; empty = inherit the monitoring default. */
  cadence: string
  /** Availability-target percentage input; empty = no target. */
  target: string
  targetWindow: "24H" | "7D" | "30D"
  /** Auto-disable streak override; empty = inherit the global default. */
  autoDisable: string
  authMode: UrlCheckAuthMode
  credentialId: string
  usernameKey: string
  passwordKey: string
  tokenKey: string
  headers: HeaderRow[]
}

export interface ManagedInstanceDraft {
  instanceKey: string
  environment: string
  url: string
  region: string
  version: string
  check: ManagedCheckDraft
}

export interface ProfileDraft {
  componentKey: string
  name: string
  instances: ManagedInstanceDraft[]
}

export interface CollectionDraft {
  sourceKey: string
  components: ProfileDraft[]
}

const emptyCheck = (name: string): ManagedCheckDraft => ({
  checkKey: uuidv7(),
  name,
  url: "",
  method: "GET",
  enabled: true,
  statuses: "200-299",
  cadence: "",
  target: "",
  targetWindow: "24H",
  autoDisable: "",
  authMode: "NONE",
  credentialId: "",
  usernameKey: "username",
  passwordKey: "password",
  tokenKey: "token",
  headers: [{ name: "", key: "" }],
})

const emptyInstance = (name: string): ManagedInstanceDraft => ({
  instanceKey: uuidv7(),
  environment: "PRODUCTION",
  url: "",
  region: "",
  version: "",
  check: emptyCheck(name),
})

/** Profile name suggestion from the endpoint URL's host (FR-004). */
function hostLabel(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host ? host.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

const emptyProfile = (): ProfileDraft => ({
  componentKey: uuidv7(),
  name: "",
  instances: [emptyInstance("Availability")],
})

export const emptyCollection = (): CollectionDraft => ({
  sourceKey: uuidv7(),
  components: [emptyProfile()],
})

const DEFAULT_POLICY: SuccessPolicy = {
  codes: [],
  ranges: [{ min: 200, max: 299 }],
}

/** Seed the builder from a stored v2 collection scope (edit mode). */
export function draftFromScope(scope: unknown): CollectionDraft | null {
  const s = scope as CollectionScope | null
  if (!s || typeof s.sourceKey !== "string" || !Array.isArray(s.components)) {
    return null
  }
  return {
    sourceKey: s.sourceKey,
    components: s.components.map((c) => ({
      componentKey: c.componentKey,
      name: c.name,
      instances: c.instances.map((i) => ({
        instanceKey: i.instanceKey,
        environment: i.environment,
        url: i.url,
        region: i.region ?? "",
        version: i.version ?? "",
        check: {
          checkKey: i.check.checkKey,
          name: i.check.name,
          url: i.check.url ?? "",
          method: (i.check.method ?? "GET") as UrlCheckMethod,
          enabled: i.check.enabled ?? true,
          statuses: statusesInputOf(i.check.successPolicy ?? DEFAULT_POLICY),
          cadence:
            i.check.cadenceSeconds != null
              ? String(i.check.cadenceSeconds)
              : "",
          target:
            i.check.availabilityTarget != null
              ? String(i.check.availabilityTarget)
              : "",
          targetWindow:
            (i.check.targetWindow as "24H" | "7D" | "30D" | undefined) ??
            "24H",
          autoDisable:
            i.check.autoDisableAfter != null
              ? String(i.check.autoDisableAfter)
              : "",
          authMode: (i.check.authMode ?? "NONE") as UrlCheckAuthMode,
          credentialId: i.check.credentialId ?? "",
          usernameKey:
            (i.check.authConfig as { usernameKey?: string } | null)
              ?.usernameKey ?? "username",
          passwordKey:
            (i.check.authConfig as { passwordKey?: string } | null)
              ?.passwordKey ?? "password",
          tokenKey:
            (i.check.authConfig as { tokenKey?: string } | null)?.tokenKey ??
            "token",
          headers:
            (i.check.authConfig as { headers?: HeaderRow[] } | null)?.headers
              ?.length
              ? (i.check.authConfig as { headers: HeaderRow[] }).headers
              : [{ name: "", key: "" }],
        },
      })),
    })),
  }
}

/** Convert drafts to the v2 scope payload; returns { error } on the first
 *  client-detectable problem. */
export function scopeFromDraft(
  draft: CollectionDraft,
  isApi: boolean,
): { scope?: CollectionScope; error?: string } {
  if (!draft.sourceKey) return { error: "Source identity is required." }
  if (draft.components.length === 0) {
    return { error: "At least one component profile is required." }
  }
  const components = []
  for (const [ci, c] of draft.components.entries()) {
    const label = c.name.trim() || `profile ${ci + 1}`
    if (!c.name.trim()) return { error: `Profile ${ci + 1}: name is required.` }
    if (c.instances.length === 0) {
      return { error: `Profile "${label}" needs at least one instance.` }
    }
    const instances = []
    for (const [ii, i] of c.instances.entries()) {
      if (!i.environment) {
        return { error: `Profile "${label}" instance ${ii + 1}: pick an environment.` }
      }
      if (!i.url.trim()) {
        return { error: `Profile "${label}" instance ${ii + 1}: URL is required.` }
      }
      const chk = i.check
      if (!chk.name.trim()) {
        return { error: `Profile "${label}" instance ${ii + 1}: check name is required.` }
      }
      const policy = parseStatusesInput(chk.statuses)
      if (policy.error || !policy.policy) {
        return { error: `Profile "${label}" instance ${ii + 1}: ${policy.error ?? "Invalid accepted statuses."}` }
      }
      const successPolicy = policy.policy
      let cadenceSeconds: number | null = null
      if (chk.cadence.trim() !== "") {
        const n = Number(chk.cadence)
        if (
          !Number.isInteger(n) ||
          n < URL_CHECK_MIN_CADENCE_SECONDS ||
          n > URL_CHECK_MAX_CADENCE_SECONDS
        ) {
          return {
            error: `Profile "${label}" instance ${ii + 1}: cadence must be ${URL_CHECK_MIN_CADENCE_SECONDS}–${URL_CHECK_MAX_CADENCE_SECONDS} seconds.`,
          }
        }
        cadenceSeconds = n
      }
      let availabilityTarget: number | null = null
      if (chk.target.trim() !== "") {
        const t = Number(chk.target)
        if (!Number.isFinite(t) || t < 0 || t > 100) {
          return { error: `Profile "${label}" instance ${ii + 1}: availability target must be 0-100.` }
        }
        availabilityTarget = t
      }
      let autoDisableAfter: number | null = null
      if (chk.autoDisable.trim() !== "") {
        const n = Number(chk.autoDisable)
        if (!Number.isInteger(n) || n < 0 || n > URL_CHECK_AUTO_DISABLE_AFTER_MAX) {
          return {
            error: `Profile "${label}" instance ${ii + 1}: auto-disable must be 0–${URL_CHECK_AUTO_DISABLE_AFTER_MAX}.`,
          }
        }
        autoDisableAfter = n
      }
      const authDraft = { isApi, ...chk }
      const authMode = isApi ? chk.authMode : "NONE"
      const authConfig = urlCheckAuthConfigOf(authDraft)
      const authError = validateUrlCheckDraft(authDraft)
      if (authError) {
        return { error: `Profile "${label}" instance ${ii + 1}: ${authError}` }
      }
      instances.push({
        instanceKey: i.instanceKey,
        environment: i.environment as (typeof ENVIRONMENTS)[number],
        url: i.url.trim(),
        ...(i.region.trim() ? { region: i.region.trim() } : {}),
        ...(i.version.trim() ? { version: i.version.trim() } : {}),
        check: {
          checkKey: chk.checkKey,
          name: chk.name.trim(),
          ...(chk.url.trim() ? { url: chk.url.trim() } : {}),
          method: chk.method,
          enabled: chk.enabled,
          successPolicy,
          cadenceSeconds,
          authMode,
          credentialId: authMode === "NONE" ? null : chk.credentialId || null,
          authConfig,
          availabilityTarget,
          targetWindow: availabilityTarget != null ? chk.targetWindow : null,
          autoDisableAfter,
        },
      })
    }
    components.push({
      componentKey: c.componentKey,
      name: c.name.trim(),
      instances,
    })
  }
  return { scope: { sourceKey: draft.sourceKey, components } }
}

function CheckFields({
  check,
  onChange,
  isApi,
  idBase,
}: {
  check: ManagedCheckDraft
  onChange: (c: ManagedCheckDraft) => void
  isApi: boolean
  idBase: string
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_minmax(5rem,auto)]">
        <Field>
          <FieldLabel htmlFor={`${idBase}-check-name`}>Check name</FieldLabel>
          <Input
            id={`${idBase}-check-name`}
            value={check.name}
            onChange={(e) => onChange({ ...check, name: e.target.value })}
            placeholder="Availability"
            autoComplete="off"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idBase}-check-url`}>Check URL override</FieldLabel>
          <Input
            id={`${idBase}-check-url`}
            value={check.url}
            onChange={(e) => onChange({ ...check, url: e.target.value })}
            placeholder="Optional — defaults to the instance URL"
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idBase}-check-method`}>Method</FieldLabel>
          <Select
            value={check.method}
            onValueChange={(v) => onChange({ ...check, method: v as UrlCheckMethod })}
          >
            <SelectTrigger id={`${idBase}-check-method`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="HEAD">HEAD</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} data-icon="inline-start" />
          Advanced
        </Button>
      </div>
      {open && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${idBase}-statuses`}>Accepted statuses</FieldLabel>
            <Input
              id={`${idBase}-statuses`}
              value={check.statuses}
              onChange={(e) => onChange({ ...check, statuses: e.target.value })}
              placeholder="200-299,301"
              autoComplete="off"
              className="font-mono"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idBase}-cadence`}>Cadence override (seconds)</FieldLabel>
            <Input
              id={`${idBase}-cadence`}
              value={check.cadence}
              onChange={(e) => onChange({ ...check, cadence: e.target.value })}
              placeholder="Inherit default"
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idBase}-target`}>Availability target (%)</FieldLabel>
            <Input
              id={`${idBase}-target`}
              value={check.target}
              onChange={(e) => onChange({ ...check, target: e.target.value })}
              placeholder="Optional, e.g. 99.9"
              inputMode="decimal"
              autoComplete="off"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idBase}-target-window`}>Target window</FieldLabel>
            <Select
              value={check.targetWindow}
              onValueChange={(v) => onChange({ ...check, targetWindow: v as "24H" | "7D" | "30D" })}
              disabled={check.target.trim() === ""}
            >
              <SelectTrigger id={`${idBase}-target-window`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24H">24 hours</SelectItem>
                <SelectItem value="7D">7 days</SelectItem>
                <SelectItem value="30D">30 days</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idBase}-auto-disable`}>Auto-disable after consecutive failures</FieldLabel>
            <Input
              id={`${idBase}-auto-disable`}
              value={check.autoDisable}
              onChange={(e) => onChange({ ...check, autoDisable: e.target.value })}
              placeholder={`${URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT} (global default)`}
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
          <Field orientation="horizontal" className="items-center justify-between">
            <FieldLabel htmlFor={`${idBase}-enabled`}>Enabled</FieldLabel>
            <Switch
              id={`${idBase}-enabled`}
              checked={check.enabled}
              onCheckedChange={(v) => onChange({ ...check, enabled: v })}
              aria-label="Check enabled"
            />
          </Field>
        </div>
      )}
      {isApi && open && (
        <UrlCheckAuthFields
          idPrefix={`${idBase}-auth`}
          authMode={check.authMode}
          setAuthMode={(v) => onChange({ ...check, authMode: v })}
          credentialId={check.credentialId}
          setCredentialId={(v) => onChange({ ...check, credentialId: v })}
          usernameKey={check.usernameKey}
          setUsernameKey={(v) => onChange({ ...check, usernameKey: v })}
          passwordKey={check.passwordKey}
          setPasswordKey={(v) => onChange({ ...check, passwordKey: v })}
          tokenKey={check.tokenKey}
          setTokenKey={(v) => onChange({ ...check, tokenKey: v })}
          headers={check.headers}
          setHeaders={(v) => onChange({ ...check, headers: v })}
        />
      )}
    </div>
  )
}

/**
 * Component-profile editor for the Web/API collection scope (spec 058,
 * ADR-126): one ImporterConfig declares profiles, per-environment
 * instances, and one managed check each. Stable keys are generated here —
 * the scope JSON is the durable Source identity.
 */
export function CollectionScopeBuilder({
  draft,
  onChange,
  isApi,
}: {
  draft: CollectionDraft
  onChange: (d: CollectionDraft) => void
  isApi: boolean
}) {
  const patchComponent = (key: string, p: Partial<ProfileDraft>) =>
    onChange({
      ...draft,
      components: draft.components.map((c) =>
        c.componentKey === key ? { ...c, ...p } : c,
      ),
    })

  const patchInstance = (
    compKey: string,
    instKey: string,
    p: Partial<ManagedInstanceDraft>,
  ) =>
    onChange({
      ...draft,
      components: draft.components.map((c) =>
        c.componentKey === compKey
          ? {
              ...c,
              instances: c.instances.map((i) =>
                i.instanceKey === instKey ? { ...i, ...p } : i,
              ),
            }
          : c,
      ),
    })

  return (
    <FieldGroup>
      {draft.components.map((profile, ci) => (
        <div key={profile.componentKey} className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              Component profile {ci + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove component profile ${ci + 1}`}
              disabled={draft.components.length === 1}
              onClick={() =>
                onChange({
                  ...draft,
                  components: draft.components.filter(
                    (c) => c.componentKey !== profile.componentKey,
                  ),
                })
              }
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
          <Field>
            <FieldLabel htmlFor={`csb-name-${profile.componentKey}`}>Component name</FieldLabel>
            <Input
              id={`csb-name-${profile.componentKey}`}
              value={profile.name}
              onChange={(e) =>
                patchComponent(profile.componentKey, { name: e.target.value })
              }
              placeholder="Storefront"
              autoComplete="off"
            />
          </Field>
          {profile.instances.map((inst, ii) => (
            <div key={inst.instanceKey} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Instance {ii + 1}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move instance ${ii + 1} of profile ${ci + 1} up`}
                    disabled={ii === 0}
                    onClick={() =>
                      patchComponent(profile.componentKey, {
                        instances: profile.instances.map((i, j) =>
                          j === ii - 1
                            ? profile.instances[ii]!
                            : j === ii
                              ? profile.instances[ii - 1]!
                              : i,
                        ),
                      })
                    }
                  >
                    <ArrowUpIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move instance ${ii + 1} of profile ${ci + 1} down`}
                    disabled={ii === profile.instances.length - 1}
                    onClick={() =>
                      patchComponent(profile.componentKey, {
                        instances: profile.instances.map((i, j) =>
                          j === ii + 1
                            ? profile.instances[ii]!
                            : j === ii
                              ? profile.instances[ii + 1]!
                              : i,
                        ),
                      })
                    }
                  >
                    <ArrowDownIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove instance ${ii + 1} of profile ${ci + 1}`}
                    disabled={profile.instances.length === 1}
                    onClick={() =>
                      patchComponent(profile.componentKey, {
                        instances: profile.instances.filter(
                          (i) => i.instanceKey !== inst.instanceKey,
                        ),
                      })
                    }
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`csb-env-${inst.instanceKey}`}>Environment</FieldLabel>
                  <Select
                    value={inst.environment}
                    onValueChange={(v) =>
                      patchInstance(profile.componentKey, inst.instanceKey, {
                        environment: v,
                      })
                    }
                  >
                    <SelectTrigger id={`csb-env-${inst.instanceKey}`} className="w-full">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {ENVIRONMENTS.map((env) => (
                        <SelectItem key={env} value={env}>
                          {ENVIRONMENT_META[env].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`csb-url-${inst.instanceKey}`}>URL</FieldLabel>
                  <Input
                    id={`csb-url-${inst.instanceKey}`}
                    value={inst.url}
                    onChange={(e) => {
                      const url = e.target.value;
                      patchInstance(profile.componentKey, inst.instanceKey, {
                        url,
                      });
                      if (!profile.name.trim()) {
                        const suggested = hostLabel(url);
                        if (suggested) {
                          patchComponent(profile.componentKey, { name: suggested });
                        }
                      }
                    }}
                    placeholder="https://…"
                    autoComplete="off"
                    className="font-mono"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`csb-region-${inst.instanceKey}`}>Region</FieldLabel>
                  <Input
                    id={`csb-region-${inst.instanceKey}`}
                    value={inst.region}
                    onChange={(e) =>
                      patchInstance(profile.componentKey, inst.instanceKey, {
                        region: e.target.value,
                      })
                    }
                    placeholder="Optional"
                    autoComplete="off"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${inst.instanceKey}-version`}>Version</FieldLabel>
                  <Input
                    id={`${inst.instanceKey}-version`}
                    value={inst.version}
                    onChange={(e) =>
                      patchInstance(profile.componentKey, inst.instanceKey, {
                        version: e.target.value,
                      })
                    }
                    placeholder="Optional"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <CheckFields
                check={inst.check}
                onChange={(c) =>
                  patchInstance(profile.componentKey, inst.instanceKey, {
                    check: c,
                  })
                }
                isApi={isApi}
                idBase={`csb-check-${inst.instanceKey}`}
              />
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                patchComponent(profile.componentKey, {
                  instances: [...profile.instances, emptyInstance("Availability")],
                })
              }
            >
              <PlusIcon data-icon="inline-start" />
              Add instance
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange({ ...draft, components: [...draft.components, emptyProfile()] })
          }
        >
          <PlusIcon data-icon="inline-start" />
          Add component profile
        </Button>
      </div>
      <FieldDescription>
        Profiles become Components, each instance becomes a ComponentInstance
        with one managed URL Check. Check definitions are the canonical
        declaration — the first run materializes them.
      </FieldDescription>
    </FieldGroup>
  )
}
