import { SettingsSection } from "@/ux/components/settings/settings-section";
import { Checkbox } from "@/ux/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import { flags } from "@/ux/lib/flags";

const EVENTS = [
  { id: "import-failed", label: "An importer run fails", email: true, inApp: true },
  { id: "instance-error", label: "An instance I own enters Error", email: true, inApp: true },
  { id: "credential-expiry", label: "A credential expires within 14 days", email: true, inApp: true },
  { id: "suggestion", label: "New relationship suggestions", email: false, inApp: true },
  { id: "ownership", label: "I'm assigned as owner", email: true, inApp: true },
  { id: "digest", label: "Weekly catalog digest", email: true, inApp: false },
];

export function UxSettingsNotificationsPage() {
  return (
    <SettingsSection
      title="Notifications"
      description={
        flags.notifications
          ? "Choose where you hear about changes to things you own."
          : "Notification preferences are not yet stored by the backend — this matrix is preview-only (gap G15)."
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-0">Event</TableHead>
            <TableHead className="w-20 text-center">Email</TableHead>
            <TableHead className="w-20 pr-0 text-center">In-app</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {EVENTS.map((e) => (
            <TableRow key={e.id} className="hover:bg-transparent">
              <TableCell className="pl-0 text-sm">{e.label}</TableCell>
              <TableCell className="text-center">
                <Checkbox defaultChecked={e.email} disabled={!flags.notifications} aria-label={`Email: ${e.label}`} />
              </TableCell>
              <TableCell className="pr-0 text-center">
                <Checkbox defaultChecked={e.inApp} disabled={!flags.notifications} aria-label={`In-app: ${e.label}`} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SettingsSection>
  );
}
