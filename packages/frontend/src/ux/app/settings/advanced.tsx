import { DownloadIcon } from "lucide-react";
import { SettingsSection, SettingRow } from "@/ux/components/settings/settings-section";
import { Button } from "@/ux/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { Switch } from "@/ux/components/ui/switch";
import { flags } from "@/ux/lib/flags";

export function UxSettingsAdvancedPage() {
  if (!flags.advancedOps) {
    return (
      <SettingsSection
        title="Advanced"
        description="Retention, export and destructive workspace operations are not yet backed by the API (gap G19). This section ships empty until they land."
      >
        <p className="text-sm text-muted-foreground">Nothing to configure here yet.</p>
      </SettingsSection>
    );
  }
  return (
    <>
      <SettingsSection title="Data retention" description="How long Componode keeps historical records.">
        <SettingRow
          id="gone-retention"
          label="Keep “Gone” instances for"
          description="Instances that disappeared from a provider are hidden, then purged after this window."
          control={
            <Select defaultValue="30">
              <SelectTrigger id="gone-retention" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          id="suggestions"
          label="Automatic relationship suggestions"
          description="Infer relationships from tags and traces after each import run."
          control={<Switch id="suggestions" defaultChecked />}
        />
      </SettingsSection>
      <SettingsSection title="Export" description="Download the full catalog as JSON. Secrets are never included.">
        <Button type="button" variant="outline">
          <DownloadIcon data-icon="inline-start" />
          Export catalog
        </Button>
      </SettingsSection>
    </>
  );
}
