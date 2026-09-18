import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCredentials, useCreateCredential } from "@/api/hooks/credentials";
import { CredentialForm } from "@/components/credential-form";
import type { ImporterConfig, ImporterManifest } from "@/api/types";

interface SecretRef {
  key: string;
  env?: string;
  file?: string;
}

export interface ImporterConfigFormOutput {
  importerName: string;
  label: string;
  scope: Record<string, unknown>;
  secretRefs: SecretRef[];
  credentialIds: string[];
  schedule: string | null;
  enabled: boolean;
}

interface ImporterConfigFormProps {
  mode: "create" | "edit";
  config?: ImporterConfig | null;
  manifests: ImporterManifest[];
  isPending: boolean;
  onSubmit: (values: ImporterConfigFormOutput) => Promise<void>;
  onCancel: () => void;
  // Shown next to the DEPRECATED badge when the config still has legacy
  // env/file secret refs — one-click migration to a stored credential.
  onConvertSecrets?: () => Promise<void>;
}

const GITHUB_ENVIRONMENTS = ["DEV", "TEST", "STAGING", "DEMO", "PRODUCTION", "OTHER"];

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ImporterConfigForm({
  mode,
  config,
  manifests,
  isPending,
  onSubmit,
  onCancel,
  onConvertSecrets,
}: ImporterConfigFormProps) {
  const [importerName, setImporterName] = useState(config?.importerName ?? "");
  const [label, setLabel] = useState(config?.label ?? "");
  const [schedule, setSchedule] = useState(config?.schedule ?? "");
  const [enabled, setEnabled] = useState(config?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  // Stored credential (spec 013): one credential per config in v1 UI.
  const [credentialId, setCredentialId] = useState<string>(config?.credentialIds?.[0] ?? "");
  const [showNewCredential, setShowNewCredential] = useState(false);
  const credentialsQuery = useCredentials();
  const createCredential = useCreateCredential();
  const credentials = credentialsQuery.data?.credentials ?? [];

  // GitHub scope fields
  const [org, setOrg] = useState<string>("");
  const [repos, setRepos] = useState<string>("");
  const [includeForks, setIncludeForks] = useState<boolean>(false);
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);
  const [token, setToken] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [billingPeriod, setBillingPeriod] = useState<string>("current");
  const [includeOrganization, setIncludeOrganization] = useState<boolean>(true);
  const [includeBilling, setIncludeBilling] = useState<boolean>(true);
  const [includeEnvironments, setIncludeEnvironments] = useState<boolean>(true);
  const [includeReleases, setIncludeReleases] = useState<boolean>(true);
  const [includeWorkflows, setIncludeWorkflows] = useState<boolean>(false);
  const [includeRunners, setIncludeRunners] = useState<boolean>(false);
  const [includePackages, setIncludePackages] = useState<boolean>(false);
  const [environmentMapping, setEnvironmentMapping] = useState<string>("");

  // Fallback JSON fields (for non-github importers until we have per-importer schema rendering)
  const [scopeJson, setScopeJson] = useState(
    config?.scope ? JSON.stringify(config.scope, null, 2) : "{}",
  );
  const [secretRefsJson, setSecretRefsJson] = useState(
    config?.secretRefs ? JSON.stringify(config.secretRefs, null, 2) : "[]",
  );

  const isGithub = importerName === "github";

  useEffect(() => {
    if (config) {
      setImporterName(config.importerName);
      setLabel(config.label);
      setSchedule(config.schedule ?? "");
      setEnabled(config.enabled);

      const refs = (config.secretRefs ?? []) as SecretRef[];
      const tokenRef = refs.find((r) => r.key === "token");
      setToken(tokenRef?.env ?? tokenRef?.file ?? "");
      setCredentialId(config.credentialIds?.[0] ?? "");

      if (config.importerName === "github" && config.scope && typeof config.scope === "object") {
        const scope = config.scope as Record<string, unknown>;
        setOrg((scope.org as string) ?? "");
        setRepos(Array.isArray(scope.repos) ? (scope.repos as string[]).join(", ") : "");
        setIncludeForks(Boolean(scope.includeForks));
        setIncludeArchived(Boolean(scope.includeArchived));
        setBaseUrl((scope.baseUrl as string) ?? "");
        setBillingPeriod((scope.billingPeriod as string) ?? "current");
        setIncludeOrganization(scope.includeOrganization !== false);
        setIncludeBilling(scope.includeBilling !== false);
        setIncludeEnvironments(scope.includeEnvironments !== false);
        setIncludeReleases(scope.includeReleases !== false);
        setIncludeWorkflows(Boolean(scope.includeWorkflows));
        setIncludeRunners(Boolean(scope.includeRunners));
        setIncludePackages(Boolean(scope.includePackages));
        setEnvironmentMapping(
          scope.environmentMapping && typeof scope.environmentMapping === "object"
            ? Object.entries(scope.environmentMapping as Record<string, string>)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")
            : "",
        );
      } else {
        setScopeJson(JSON.stringify(config.scope, null, 2));
      }
      setSecretRefsJson(JSON.stringify(refs, null, 2));
    }
  }, [config]);

  const selectedManifest = manifests.find((m) => m.name === importerName);
  const baseId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let scope: Record<string, unknown>;
    let secretRefs: SecretRef[];

    if (isGithub) {
      const mapping: Record<string, string> = {};
      for (const pair of environmentMapping.split(",")) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) {
          setError(`Invalid environment mapping entry "${trimmed}" — expected name=ENVIRONMENT`);
          return;
        }
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().toUpperCase();
        if (!GITHUB_ENVIRONMENTS.includes(value)) {
          setError(`Unknown environment "${value}" — allowed: ${GITHUB_ENVIRONMENTS.join(", ")}`);
          return;
        }
        mapping[key] = value;
      }

      scope = {
        org: org.trim(),
        repos: repos
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r.length > 0),
        includeForks,
        includeArchived,
        includeOrganization,
        includeBilling,
        billingPeriod,
        includeEnvironments,
        includeReleases,
        includeWorkflows,
        includeRunners,
        includePackages,
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(Object.keys(mapping).length > 0 ? { environmentMapping: mapping } : {}),
      };
      // A stored credential supersedes the legacy env token ref — providing
      // both would collide on the required "token" key.
      secretRefs = credentialId
        ? []
        : ([{ key: "token", env: token.trim() || undefined }].filter(
            (r) => r.env,
          ) as SecretRef[]);

      if (!org.trim()) {
        setError("GitHub organization is required");
        return;
      }
    } else {
      try {
        scope = JSON.parse(scopeJson);
        if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
          throw new Error("Scope must be a JSON object");
        }
      } catch (err) {
        setError(`Invalid scope JSON: ${errMessage(err)}`);
        return;
      }

      try {
        const parsed = JSON.parse(secretRefsJson);
        if (!Array.isArray(parsed)) {
          throw new Error("Secret refs must be a JSON array");
        }
        secretRefs = parsed as SecretRef[];
      } catch (err) {
        setError(`Invalid secret refs JSON: ${errMessage(err)}`);
        return;
      }
    }

    if (!label.trim()) {
      setError("Label is required");
      return;
    }

    const payload: ImporterConfigFormOutput = {
      importerName,
      label: label.trim(),
      scope,
      secretRefs,
      credentialIds: credentialId ? [credentialId] : [],
      schedule: schedule.trim() || null,
      enabled,
    };

    try {
      await onSubmit(payload);
    } catch (err) {
      setError(errMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${baseId}-importerName`}>Importer</Label>
        <Select
          id={`${baseId}-importerName`}
          value={importerName}
          onChange={(e) => setImporterName(e.target.value)}
          required
          disabled={mode === "edit"}
        >
          <option value="" disabled>
            Select an importer
          </option>
          {manifests.map((m) => (
            <option key={m.name} value={m.name}>
              {m.label}
            </option>
          ))}
        </Select>
        {selectedManifest && (
          <p className="text-sm text-muted-foreground">
            {selectedManifest.description}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${baseId}-label`}>Label</Label>
        <Input
          id={`${baseId}-label`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Production GitHub org"
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${baseId}-credential`}>Stored credential</Label>
          {config?.secretRefsDeprecated && (
            <>
              <Badge variant="secondary" title="This config still uses legacy env/file secret refs">
                DEPRECATED
              </Badge>
              {onConvertSecrets && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  disabled={isPending}
                  onClick={async () => {
                    setError(null);
                    try {
                      await onConvertSecrets();
                    } catch (err) {
                      setError(errMessage(err));
                    }
                  }}
                >
                  Migrate to credential store
                </Button>
              )}
            </>
          )}
        </div>
        <Select
          id={`${baseId}-credential`}
          value={credentialId}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new__") {
              setShowNewCredential(true);
              return;
            }
            setCredentialId(v);
          }}
        >
          <option value="">None</option>
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({Object.keys(c.keyHints).join(", ")})
            </option>
          ))}
          <option value="__new__">+ Store new credential…</option>
        </Select>
        <p className="text-xs text-muted-foreground">
          Encrypted in the credential store — preferred over env/file refs.
        </p>
      </div>

      {showNewCredential && (
        <div className="space-y-2 rounded-md border p-4 bg-muted/30">
          <p className="text-sm font-medium">Store new credential</p>
          <CredentialForm
            submitting={createCredential.isPending}
            onCancel={() => setShowNewCredential(false)}
            onSubmit={async (input) => {
              const res = await createCredential.mutateAsync(input);
              setCredentialId(res.credential.id);
              setShowNewCredential(false);
            }}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${baseId}-schedule`}>Schedule (cron)</Label>
        <Input
          id={`${baseId}-schedule`}
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="0 0 * * *"
        />
      </div>

      {isGithub ? (
        <div className="space-y-4 rounded-md border p-4 bg-muted/30">
          <p className="text-sm font-medium">GitHub configuration</p>
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-org`}>Organization</Label>
            <Input
              id={`${baseId}-org`}
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="acme-corp"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${baseId}-repos`}>
              Repositories (optional, comma separated)
            </Label>
            <Input
              id={`${baseId}-repos`}
              value={repos}
              onChange={(e) => setRepos(e.target.value)}
              placeholder="repo-a, repo-b, org/repo-c"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`${baseId}-token`}>Token env ref (legacy)</Label>
              <Badge variant="secondary">DEPRECATED</Badge>
            </div>
            <Input
              id={`${baseId}-token`}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="GITHUB_TOKEN"
              disabled={!!credentialId}
            />
            <p className="text-xs text-muted-foreground">
              {credentialId
                ? "Ignored — the stored credential above supplies the token."
                : "Environment variable name resolved on the server. Prefer a stored credential."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${baseId}-baseUrl`}>API base URL (GHES only, optional)</Label>
            <Input
              id={`${baseId}-baseUrl`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://ghes.example.com/api/v3"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${baseId}-billingPeriod`}>Billing period</Label>
            <Select
              id={`${baseId}-billingPeriod`}
              value={billingPeriod}
              onChange={(e) => setBillingPeriod(e.target.value)}
            >
              <option value="current">Current month</option>
              <option value="previous">Previous month</option>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${baseId}-envMapping`}>
              Environment mapping (optional, name=ENV comma pairs)
            </Label>
            <Input
              id={`${baseId}-envMapping`}
              value={environmentMapping}
              onChange={(e) => setEnvironmentMapping(e.target.value)}
              placeholder="main=PRODUCTION, develop=DEV"
            />
            <p className="text-xs text-muted-foreground">
              Classifies branches and GitHub environments. Allowed: {GITHUB_ENVIRONMENTS.join(", ")}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-forks`}
                checked={includeForks}
                onCheckedChange={setIncludeForks}
              />
              <Label htmlFor={`${baseId}-forks`}>Include forks</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-archived`}
                checked={includeArchived}
                onCheckedChange={setIncludeArchived}
              />
              <Label htmlFor={`${baseId}-archived`}>Include archived</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-orgSwitch`}
                checked={includeOrganization}
                onCheckedChange={setIncludeOrganization}
              />
              <Label htmlFor={`${baseId}-orgSwitch`}>Import organization (profile, plan, teams)</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-billing`}
                checked={includeBilling}
                onCheckedChange={setIncludeBilling}
              />
              <Label htmlFor={`${baseId}-billing`}>Import billing/usage</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-envs`}
                checked={includeEnvironments}
                onCheckedChange={setIncludeEnvironments}
              />
              <Label htmlFor={`${baseId}-envs`}>Import deployment environments</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-releases`}
                checked={includeReleases}
                onCheckedChange={setIncludeReleases}
              />
              <Label htmlFor={`${baseId}-releases`}>Use releases for version fallback</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-workflows`}
                checked={includeWorkflows}
                onCheckedChange={setIncludeWorkflows}
              />
              <Label htmlFor={`${baseId}-workflows`}>Import workflows</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-runners`}
                checked={includeRunners}
                onCheckedChange={setIncludeRunners}
              />
              <Label htmlFor={`${baseId}-runners`}>Import self-hosted runners</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${baseId}-packages`}
                checked={includePackages}
                onCheckedChange={setIncludePackages}
              />
              <Label htmlFor={`${baseId}-packages`}>Import packages</Label>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${baseId}-scope`}>Scope (JSON)</Label>
            <textarea
              id={`${baseId}-scope`}
              value={scopeJson}
              onChange={(e) => setScopeJson(e.target.value)}
              rows={6}
              className={cn(
                "flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "font-mono",
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${baseId}-secretRefs`}>Secret refs (JSON array)</Label>
            <textarea
              id={`${baseId}-secretRefs`}
              value={secretRefsJson}
              onChange={(e) => setSecretRefsJson(e.target.value)}
              rows={4}
              className={cn(
                "flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "font-mono",
              )}
            />
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <Switch id={`${baseId}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor={`${baseId}-enabled`}>Enabled</Label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {mode === "create" ? "Create" : "Save"}
        </Button>
      </div>
    </form>
  );
}
