import { useEffect, useState, type FormEvent } from "react";
import { type ApiError } from "@/api/client";
import { useSettings, useUpdateSettings } from "@/api/hooks/settings";
import { useOidcConfig, useUpdateOidcConfig } from "@/api/hooks/settings";
import { useCredentials } from "@/api/hooks/credentials";
import { useChangePassword } from "@/api/hooks/password";
import type { AppSettings, OidcConfig, UserRole } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";

const ROLES: UserRole[] = ["VIEWER", "EDITOR", "ADMIN"];

function errMessage(err: unknown, fallback: string): string {
  return (err as ApiError).message ?? fallback;
}

function isForbidden(err: unknown): boolean {
  return (err as ApiError).code === "FORBIDDEN";
}

function FormCardSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-1/2" />
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const {
    data: rawSettingsData,
    isPending: settingsPending,
    error: settingsError,
    refetch: refetchSettings,
  } = useSettings();
  const settingsData = rawSettingsData as { settings?: AppSettings } | undefined;
  const updateSettings = useUpdateSettings();

  const {
    data: rawOidcData,
    isPending: oidcPending,
    error: oidcError,
    refetch: refetchOidc,
  } = useOidcConfig();
  const oidcData = rawOidcData as { oidc?: OidcConfig } | undefined;
  const updateOidc = useUpdateOidcConfig();

  const changePassword = useChangePassword();

  return (
    <div className="bg-background p-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="space-y-6 max-w-2xl">
        {settingsError && isForbidden(settingsError) ? (
          <Forbidden />
        ) : settingsPending && !settingsData?.settings ? (
          <FormCardSkeleton title="Application Settings" />
        ) : settingsError ? (
          <ErrorState error={settingsError} onRetry={() => refetchSettings()} />
        ) : (
          <AppSettingsCard
            settings={settingsData?.settings}
            saving={updateSettings.isPending}
            onSave={(vars) => updateSettings.mutateAsync(vars)}
          />
        )}

        {oidcError && isForbidden(oidcError) ? (
          <Forbidden />
        ) : oidcPending && !oidcData?.oidc ? (
          <FormCardSkeleton title="OIDC Configuration" />
        ) : oidcError ? (
          <ErrorState error={oidcError} onRetry={() => refetchOidc()} />
        ) : (
          <OidcConfigCard
            config={oidcData?.oidc}
            saving={updateOidc.isPending}
            onSave={(vars) => updateOidc.mutateAsync(vars)}
          />
        )}

        <PasswordChangeCard
          saving={changePassword.isPending}
          onSubmit={(vars) => changePassword.mutateAsync(vars)}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App settings                                                        */
/* ------------------------------------------------------------------ */

interface AppSettingsCardProps {
  settings?: AppSettings;
  saving: boolean;
  onSave: (vars: AppSettings) => Promise<unknown>;
}

function AppSettingsCard({ settings, saving, onSave }: AppSettingsCardProps) {
  const [form, setForm] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  if (!form) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setSaved(false);

    if (form.sessionIdleTimeoutMs < 60000 || form.sessionIdleTimeoutMs > 86400000) {
      setError("Idle timeout must be between 60,000 and 86,400,000 ms.");
      return;
    }
    if (form.sessionAbsoluteTimeoutMs < 300000 || form.sessionAbsoluteTimeoutMs > 604800000) {
      setError("Absolute timeout must be between 300,000 and 604,800,000 ms.");
      return;
    }
    if (form.sessionIdleTimeoutMs >= form.sessionAbsoluteTimeoutMs) {
      setError("Idle timeout must be less than absolute timeout.");
      return;
    }

    try {
      await onSave(form);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err, "Failed to save settings."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application Settings</CardTitle>
        <CardDescription>Core application configuration.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="allowSelfRegistration">Allow self-registration</Label>
            <Switch
              id="allowSelfRegistration"
              checked={form.allowSelfRegistration}
              onCheckedChange={(v) => setForm({ ...form, allowSelfRegistration: v })}
              aria-label="Allow self-registration"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sessionIdleTimeoutMs">Session idle timeout (ms)</Label>
            <Input
              id="sessionIdleTimeoutMs"
              type="number"
              min={60000}
              max={86400000}
              value={form.sessionIdleTimeoutMs}
              onChange={(e) =>
                setForm({ ...form, sessionIdleTimeoutMs: Number(e.target.value) })
              }
            />
            <p className="text-xs text-muted-foreground">Min 60,000 ms; max 86,400,000 ms.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sessionAbsoluteTimeoutMs">Session absolute timeout (ms)</Label>
            <Input
              id="sessionAbsoluteTimeoutMs"
              type="number"
              min={300000}
              max={604800000}
              value={form.sessionAbsoluteTimeoutMs}
              onChange={(e) =>
                setForm({ ...form, sessionAbsoluteTimeoutMs: Number(e.target.value) })
              }
            />
            <p className="text-xs text-muted-foreground">Min 300,000 ms; max 604,800,000 ms; must be greater than idle timeout.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="defaultUserRole">Default user role</Label>
            <Select
              id="defaultUserRole"
              value={form.defaultUserRole}
              onChange={(e) =>
                setForm({ ...form, defaultUserRole: e.target.value as UserRole })
              }
            >
              {ROLES.map((r) => (
                <option
                  key={r}
                  value={r}
                  disabled={r === "ADMIN" && form.allowSelfRegistration}
                >
                  {r}
                </option>
              ))}
            </Select>
            {form.allowSelfRegistration && (
              <p className="text-xs text-muted-foreground">
                Admin cannot be the default role while self-registration is enabled.
              </p>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {saved && <p role="status" className="text-sm text-green-600">Settings saved.</p>}

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* OIDC config                                                         */
/* ------------------------------------------------------------------ */

interface OidcConfigCardProps {
  config?: OidcConfig;
  saving: boolean;
  onSave: (vars: OidcConfig) => Promise<unknown>;
}

function OidcConfigCard({ config, saving, onSave }: OidcConfigCardProps) {
  const credentialsQuery = useCredentials();
  const credentials = credentialsQuery.data?.credentials ?? [];
  const [form, setForm] = useState<OidcConfig | null>(null);
  const [mappingText, setMappingText] = useState("{}");
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setForm(config);
      setMappingText(JSON.stringify(config.roleMapping ?? {}, null, 2));
    }
  }, [config]);

  if (!form) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setSaved(false);
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(mappingText) as Record<string, string>;
      setMappingError(null);
    } catch {
      setMappingError("Role mapping must be valid JSON.");
      return;
    }
    try {
      await onSave({ ...form, roleMapping: parsed });
      setSaved(true);
    } catch (err) {
      setError(errMessage(err, "Failed to save OIDC configuration."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>OIDC Configuration</CardTitle>
        <CardDescription>OpenID Connect single sign-on settings.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="oidcEnabled">Enable OIDC</Label>
            <Switch
              id="oidcEnabled"
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
              aria-label="Enable OIDC"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidcIssuer">Issuer</Label>
            <Input
              id="oidcIssuer"
              type="url"
              value={form.issuer}
              onChange={(e) => setForm({ ...form, issuer: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidcClientId">Client ID</Label>
            <Input
              id="oidcClientId"
              type="text"
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidcClientSecretCredential">Client secret credential</Label>
            <Select
              id="oidcClientSecretCredential"
              value={form.clientSecretCredentialId ?? ""}
              onChange={(e) =>
                setForm({ ...form, clientSecretCredentialId: e.target.value || null })
              }
            >
              <option value="">None — use env ref below</option>
              {credentials
                .filter((c) => c.status === "ACTIVE")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({Object.keys(c.keyHints).join(", ")})
                  </option>
                ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Encrypted in the credential store — preferred. Create credentials
              on the Credentials page.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="oidcClientSecretRef">Client secret env ref (legacy)</Label>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                DEPRECATED
              </span>
            </div>
            <Input
              id="oidcClientSecretRef"
              type="text"
              value={form.clientSecretRef}
              onChange={(e) => setForm({ ...form, clientSecretRef: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Environment variable holding the client secret. Ignored when a
              credential is selected above.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidcRoleClaimPath">Role claim path</Label>
            <Input
              id="oidcRoleClaimPath"
              type="text"
              value={form.roleClaimPath}
              onChange={(e) => setForm({ ...form, roleClaimPath: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidcClaimValueField">Claim value field</Label>
            <Input
              id="oidcClaimValueField"
              type="text"
              value={form.claimValueField}
              onChange={(e) => setForm({ ...form, claimValueField: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="oidcRoleMapping">Role mapping (JSON)</Label>
            <textarea
              id="oidcRoleMapping"
              value={mappingText}
              onChange={(e) => setMappingText(e.target.value)}
              rows={6}
              className="flex w-full rounded-md border bg-background px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-invalid={mappingError ? true : undefined}
              aria-describedby={mappingError ? "oidc-mapping-error" : undefined}
            />
            {mappingError && (
              <p id="oidc-mapping-error" role="alert" className="text-sm text-destructive">
                {mappingError}
              </p>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {saved && (
            <p role="status" className="text-sm text-green-600">
              OIDC configuration saved.
            </p>
          )}

          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save OIDC configuration"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Password change                                                     */
/* ------------------------------------------------------------------ */

interface PasswordChangeCardProps {
  saving: boolean;
  onSubmit: (vars: { currentPassword: string; newPassword: string }) => Promise<unknown>;
}

function PasswordChangeCard({ saving, onSubmit }: PasswordChangeCardProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    try {
      await onSubmit({ currentPassword, newPassword });
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(errMessage(err, "Failed to change password."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change Password</CardTitle>
        <CardDescription>Update your account password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {saved && (
            <p role="status" className="text-sm text-green-600">
              Password changed.
            </p>
          )}

          <Button type="submit" disabled={saving}>
            {saving ? "Changing…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
