import { toast } from "sonner";
import { SettingsSection, SettingRow } from "@/ux/components/settings/settings-section";
import { ErrorState } from "@/ux/components/patterns/states";
import { StatusBadge } from "@/ux/components/patterns/status-badge";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { Switch } from "@/ux/components/ui/switch";
import { Textarea } from "@/ux/components/ui/textarea";
import { useCredentials } from "@/api/hooks/credentials";
import { useOidcConfig, useOidcStatus, useUpdateOidcConfig } from "@/api/hooks/settings";
import { errorMessage } from "@/ux/lib/api-state";

function parseRoleMapping(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function UxSettingsAuthenticationPage() {
  const config = useOidcConfig();
  const status = useOidcStatus();
  const update = useUpdateOidcConfig();
  const credentials = useCredentials();

  if (config.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (config.error || !config.data) {
    return <ErrorState description={errorMessage(config.error)} onRetry={() => void config.refetch()} />;
  }

  const oidc = config.data.oidc;
  const credOptions = (credentials.data?.credentials ?? []).filter((c) => c.status === "ACTIVE");

  return (
    <SettingsSection
      title="OpenID Connect"
      description="Single sign-on through your identity provider. Role mapping assigns workspace roles from an IdP claim."
      saveLabel="Save OIDC configuration"
      pending={update.isPending}
      onSave={(fd) => {
        const credId = String(fd.get("clientSecretCredentialId") ?? "");
        update.mutate(
          {
            enabled: fd.get("enabled") === "on",
            issuer: String(fd.get("issuer") ?? ""),
            clientId: String(fd.get("clientId") ?? ""),
            clientSecretRef: oidc.clientSecretRef,
            clientSecretCredentialId: credId === "" || credId === "none" ? null : credId,
            roleClaimPath: String(fd.get("roleClaimPath") ?? ""),
            claimValueField: String(fd.get("claimValueField") ?? ""),
            roleMapping: parseRoleMapping(String(fd.get("roleMapping") ?? "")),
          },
          {
            onSuccess: () => toast.success("OIDC configuration saved"),
            onError: (e) => toast.error(e.message),
          },
        );
      }}
    >
      <FieldGroup>
        <SettingRow
          id="oidc-enabled"
          label="Enable OIDC sign-in"
          description={
            status.data
              ? `Provider status: ${status.data.enabled ? "enabled" : "disabled"}`
              : "The sign-in page gains a “Continue with SSO” button."
          }
          control={<Switch id="oidc-enabled" name="enabled" defaultChecked={oidc.enabled} />}
        />
        <Field>
          <FieldLabel htmlFor="oidc-issuer">Issuer URL</FieldLabel>
          <Input id="oidc-issuer" name="issuer" defaultValue={oidc.issuer} placeholder="https://idp.example.com" />
        </Field>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="oidc-client">Client ID</FieldLabel>
            <Input id="oidc-client" name="clientId" defaultValue={oidc.clientId} />
          </Field>
          <Field>
            <FieldLabel htmlFor="oidc-secret">Client secret credential</FieldLabel>
            <Select name="clientSecretCredentialId" defaultValue={oidc.clientSecretCredentialId ?? "none"}>
              <SelectTrigger id="oidc-secret">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">None</SelectItem>
                  {credOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>A stored credential holding the client secret.</FieldDescription>
          </Field>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="oidc-claim">Role claim path</FieldLabel>
            <Input id="oidc-claim" name="roleClaimPath" defaultValue={oidc.roleClaimPath} placeholder="groups" className="font-mono" />
          </Field>
          <Field>
            <FieldLabel htmlFor="oidc-value-field">Claim value field</FieldLabel>
            <Input id="oidc-value-field" name="claimValueField" defaultValue={oidc.claimValueField} placeholder="name" className="font-mono" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="oidc-map">Role mapping</FieldLabel>
          <Textarea
            id="oidc-map"
            name="roleMapping"
            rows={3}
            className="font-mono text-xs"
            defaultValue={Object.entries(oidc.roleMapping ?? {})
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}
            placeholder={"admins: ADMIN\neditors: EDITOR"}
          />
          <FieldDescription>One mapping per line: claim-value → workspace role.</FieldDescription>
        </Field>
      </FieldGroup>
      {status.data && (
        <div className="mt-4 flex items-center gap-2">
          <StatusBadge tone={status.data.enabled ? "success" : "neutral"} label={status.data.enabled ? "Enabled" : "Disabled"} />
        </div>
      )}
    </SettingsSection>
  );
}
