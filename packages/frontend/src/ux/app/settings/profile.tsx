import { toast } from "sonner";
import { useSession } from "@/ux/components/app/session-context";
import { RoleBadge } from "@/ux/components/patterns/status-badge";
import { SettingsSection } from "@/ux/components/settings/settings-section";
import { Avatar, AvatarFallback } from "@/ux/components/ui/avatar";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { useUpdateSelf } from "@/api/hooks/users";
import { initials } from "@/ux/lib/format";

export function UxSettingsProfilePage() {
  const { user } = useSession();
  const updateSelf = useUpdateSelf();

  return (
    <>
      <SettingsSection
        title="Profile"
        description="How you appear to teammates in ownership and activity."
        pending={updateSelf.isPending}
        onSave={(fd) =>
          updateSelf.mutate(
            {
              displayName: String(fd.get("displayName") ?? ""),
              email: String(fd.get("email") ?? "") || undefined,
            },
            {
              onSuccess: () => toast.success("Profile updated"),
              onError: (e) => toast.error(e.message),
            },
          )
        }
      >
        <FieldGroup>
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarFallback className="text-lg">{initials(user.displayName ?? user.username)}</AvatarFallback>
            </Avatar>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="displayName">Display name</FieldLabel>
              <Input id="displayName" name="displayName" defaultValue={user.displayName ?? ""} autoComplete="name" />
            </Field>
            <Field>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input id="username" defaultValue={user.username} autoComplete="username" disabled />
              <FieldDescription>Used in mentions and audit logs. Cannot be changed.</FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" name="email" type="email" defaultValue={user.email ?? ""} autoComplete="email" />
          </Field>
        </FieldGroup>
      </SettingsSection>
      <SettingsSection title="Workspace role" description="Your role is managed by a workspace admin.">
        <div className="flex items-center justify-between">
          <RoleBadge value={user.role} />
          <span className="text-sm text-muted-foreground">Contact an admin to change it</span>
        </div>
      </SettingsSection>
    </>
  );
}
