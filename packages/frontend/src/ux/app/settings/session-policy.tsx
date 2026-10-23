import { toast } from "sonner";
import { SettingsSection, SettingRow } from "@/ux/components/settings/settings-section";
import { ErrorState } from "@/ux/components/patterns/states";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/ux/components/ui/input-group";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { Switch } from "@/ux/components/ui/switch";
import { useSettings, useUpdateSettings } from "@/api/hooks/settings";
import { errorMessage } from "@/ux/lib/api-state";
import { flags } from "@/ux/lib/flags";

const MINUTE = 60_000;
const DAY = 86_400_000;

export function UxSettingsSessionPolicyPage() {
  const settings = useSettings();
  const update = useUpdateSettings();

  if (settings.isPending) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (settings.error || !settings.data) {
    return <ErrorState description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />;
  }

  const s = settings.data.settings;

  return (
    <>
      <SettingsSection
        title="Session lifetime"
        description="How long users stay signed in. Shorter is safer; longer is friendlier."
        footerNote="Applies to new sessions only."
        pending={update.isPending}
        onSave={(fd) =>
          update.mutate(
            {
              ...s,
              sessionIdleTimeoutMs: Math.max(5, Number(fd.get("idle")) || 60) * MINUTE,
              sessionAbsoluteTimeoutMs: Math.max(1, Number(fd.get("absolute")) || 14) * DAY,
            },
            {
              onSuccess: () => toast.success("Session policy updated"),
              onError: (e) => toast.error(e.message),
            },
          )
        }
      >
        <FieldGroup className="grid gap-6 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="idle">Idle timeout</FieldLabel>
            <InputGroup>
              <InputGroupInput id="idle" name="idle" type="number" min={5} defaultValue={Math.round(s.sessionIdleTimeoutMs / MINUTE)} className="tabular" />
              <InputGroupAddon align="inline-end">
                <InputGroupText>minutes</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>Sign out after this long without activity.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="absolute">Maximum lifetime</FieldLabel>
            <InputGroup>
              <InputGroupInput id="absolute" name="absolute" type="number" min={1} defaultValue={Math.round(s.sessionAbsoluteTimeoutMs / DAY)} className="tabular" />
              <InputGroupAddon align="inline-end">
                <InputGroupText>days</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>Force re-authentication regardless of activity.</FieldDescription>
          </Field>
        </FieldGroup>
      </SettingsSection>
      {flags.sessionConcurrency && (
        <SettingsSection title="Concurrency" description="Limit how many places a user can be signed in at once.">
          <SettingRow
            id="single-session"
            label="One session per user"
            description="Signing in on a new device ends the previous session."
            control={<Switch id="single-session" />}
          />
          <SettingRow
            id="bind-ip"
            label="Bind sessions to IP address"
            description="Ends a session if its IP changes. May sign out users on mobile networks or VPNs."
            control={<Switch id="bind-ip" />}
          />
        </SettingsSection>
      )}
    </>
  );
}
