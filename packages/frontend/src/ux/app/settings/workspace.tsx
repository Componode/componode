import { Alert, AlertDescription } from "@/ux/components/ui/alert";
import { toast } from "sonner";
import { SettingsSection, SettingRow } from "@/ux/components/settings/settings-section";
import { ErrorState } from "@/ux/components/patterns/states";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { Switch } from "@/ux/components/ui/switch";
import { useSettings, useUpdateSettings } from "@/api/hooks/settings";
import { errorMessage } from "@/ux/lib/api-state";
import { flags } from "@/ux/lib/flags";

export function UxSettingsWorkspacePage() {
  const settings = useSettings();
  const update = useUpdateSettings();

  if (settings.isPending) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (settings.error || !settings.data) {
    return <ErrorState description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />;
  }

  const s = settings.data.settings;
  const save = (patch: Partial<typeof s>) =>
    update.mutate(
      { ...s, ...patch },
      {
        onSuccess: () => toast.success("Workspace settings saved"),
        onError: (e) => toast.error(e.message),
      },
    );

  return (
    <SettingsSection title="Sign-up" description="Control who can create an account in this workspace.">
      <SettingRow
        id="open-signup"
        label="Allow self-registration"
        description="Anyone can create an account with the default role below."
        control={
          <Switch
            id="open-signup"
            checked={s.allowSelfRegistration}
            onCheckedChange={(v) => save({ allowSelfRegistration: v })}
            disabled={update.isPending}
          />
        }
      />
      <SettingRow
        id="default-role"
        label="Default role for new users"
        description="Applies to self-registered users."
        control={
          <Select
            value={s.defaultUserRole}
            onValueChange={(v) => save({ defaultUserRole: v as typeof s.defaultUserRole })}
            disabled={update.isPending}
          >
            <SelectTrigger id="default-role" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="VIEWER">Viewer</SelectItem>
                <SelectItem value="EDITOR">Editor</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      />
      {!flags.workspaceProfile && (
        <Alert>
          <AlertDescription>Workspace name, URL and regional defaults need backend support — tracked as gap G18.</AlertDescription>
        </Alert>
      )}
    </SettingsSection>
  );
}
