import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { SettingsSection, SettingRow } from "@/ux/components/settings/settings-section";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { Switch } from "@/ux/components/ui/switch";
import { useUxPrefs, savePref, type UxPrefs } from "@/ux/lib/prefs";
import { cn } from "@/ux/lib/utils";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

export function UxSettingsAppearancePage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const prefs = useUxPrefs();
  React.useEffect(() => {
    setMounted(true);
  }, []);

  
  return (
    <>
      <SettingsSection title="Theme" description="Applies instantly on this device.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const selected = mounted && theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTheme(t.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary bg-accent font-medium text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <t.icon className="size-5" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Display"
        description="Tune information density for large catalogs."
      >
        <SettingRow
          id="density"
          label="Table density"
          description="Compact shows ~40% more rows per screen."
          control={
            <Select
              value={prefs.density}
              onValueChange={(v) => savePref("density", v as UxPrefs["density"])}
                          >
              <SelectTrigger id="density" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          id="reduce-motion"
          label="Reduce motion"
          description="Disable non-essential transitions and animations."
          control={
            <Switch
              id="reduce-motion"
              checked={prefs.reduceMotion}
              onCheckedChange={(v) => savePref("reduceMotion", v)}
                          />
          }
        />
        <SettingRow
          id="relative-time"
          label="Relative timestamps"
          description="Show “2h ago” instead of full dates. Hover any time to see the exact value."
          control={
            <Switch
              id="relative-time"
              checked={prefs.relativeTime}
              onCheckedChange={(v) => savePref("relativeTime", v)}
                          />
          }
        />
      </SettingsSection>
    </>
  );
}
