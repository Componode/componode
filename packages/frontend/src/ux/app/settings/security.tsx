import { LaptopIcon } from "lucide-react";
import { PASSWORD_MIN_LENGTH } from "@componode/core";
import { toast } from "sonner";
import { useSession } from "@/ux/components/app/session-context";
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog";
import { RelativeTime } from "@/ux/components/patterns/primitives";
import { SettingsSection, SettingRow } from "@/ux/components/settings/settings-section";
import { StatusBadge } from "@/ux/components/patterns/status-badge";
import { Button } from "@/ux/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { Switch } from "@/ux/components/ui/switch";
import { useChangePassword } from "@/api/hooks/password";
import { useSessions, useRevokeSession } from "@/api/hooks/sessions";
import { mapSession } from "@/api/mappers/operations";
import { flags } from "@/ux/lib/flags";

export function UxSettingsSecurityPage() {
  const { user } = useSession();
  const changePassword = useChangePassword();
  const sessions = useSessions();
  const revokeSession = useRevokeSession();
  const mine = (sessions.data?.sessions ?? []).map((s) =>
    mapSession(s, { username: user.username, displayName: user.displayName ?? user.username }),
  );

  return (
    <>
      <SettingsSection
        title="Password"
        description={`At least ${PASSWORD_MIN_LENGTH} characters on every password-setting path (ADR-099). Passphrases work great.`}
        saveLabel="Update password"
        pending={changePassword.isPending}
        onSave={(fd) => {
          const next = String(fd.get("new-password") ?? "");
          if (next !== String(fd.get("confirm-password") ?? "")) {
            toast.error("New passwords do not match");
            return;
          }
          changePassword.mutate(
            { currentPassword: String(fd.get("current-password") ?? ""), newPassword: next },
            {
              onSuccess: () => toast.success("Password updated"),
              onError: (e) => toast.error(e.message),
            },
          );
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <Input id="current-password" name="current-password" type="password" autoComplete="current-password" required />
          </Field>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input id="new-password" name="new-password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
              <FieldDescription>{`${PASSWORD_MIN_LENGTH}+ characters.`}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
              <Input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" required />
            </Field>
          </div>
        </FieldGroup>
      </SettingsSection>

      {flags.twoFactor && (
        <SettingsSection title="Two-factor authentication" description="Require a code from an authenticator app when signing in.">
          <SettingRow
            id="totp"
            label="Authenticator app"
            description="Recommended. Works offline with 1Password, Authy or Google Authenticator."
            control={<Switch id="totp" />}
          />
        </SettingsSection>
      )}

      <SettingsSection title="Your sessions" description="Devices currently signed in to your account.">
        <ul className="flex flex-col divide-y">
          {mine.length === 0 && <li className="py-3 text-sm text-muted-foreground">No sessions found.</li>}
          {mine.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <LaptopIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="text-sm font-medium">{s.device}</span>
                  {s.current && <StatusBadge tone="brand" label="This device" />}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.location} · <RelativeTime iso={s.lastSeenAt} />
                </span>
              </div>
              {!s.current && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    revokeSession.mutate(s.id, {
                      onSuccess: () => toast.success("Session revoked"),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection
        tone="destructive"
        title="Sign out everywhere"
        description="Ends every session except this one. Use if you lost a device or suspect someone else has access."
      >
        <ConfirmDialog
          trigger={
            <Button type="button" variant="destructive">
              Sign out all other sessions
            </Button>
          }
          title="Sign out all other sessions?"
          description="Every other device will be signed out immediately."
          confirmLabel="Sign out others"
          onConfirm={() =>
            mine
              .filter((s) => !s.current)
              .forEach((s) =>
                revokeSession.mutate(s.id, { onError: (e) => toast.error(e.message) }),
              )
          }
        />
      </SettingsSection>
    </>
  );
}
