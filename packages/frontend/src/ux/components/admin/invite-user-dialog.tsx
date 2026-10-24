
import { UserPlusIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/ux/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ux/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/ux/components/ui/radio-group"
import { useCreateUser } from "@/api/hooks/users"
import { ROLE_META, type Role } from "@/ux/lib/domain"

const ROLE_HELP: Record<Role, string> = {
  VIEWER: "Read the catalog. Cannot change anything.",
  EDITOR: "Edit products, components and run importers.",
  ADMIN: "Everything, plus users, credentials and workspace settings.",
}

/** Standard create-dialog pattern: ≤ 4 fields, primary action on the right, closes + toasts on success. */
export function InviteUserDialog() {
  const [open, setOpen] = React.useState(false)
  const createUser = useCreateUser()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon data-icon="inline-start" />
          New user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            createUser.mutate(
              {
                username: String(fd.get("username") ?? ""),
                password: String(fd.get("password") ?? ""),
                role: String(fd.get("role") ?? "VIEWER") as Role,
                displayName: String(fd.get("displayName") ?? "") || undefined,
                email: String(fd.get("email") ?? "") || undefined,
              },
              {
                onSuccess: () => {
                  setOpen(false)
                  toast.success("User created")
                },
                onError: (err) => toast.error(err.message),
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Create a user</DialogTitle>
            <DialogDescription>Set a temporary password — the user should change it after first sign-in.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-username">Username</FieldLabel>
              <Input id="invite-username" name="username" required placeholder="jdoe" autoComplete="off" pattern="[a-z0-9_-]+" />
              <FieldDescription>Lowercase alphanumeric with _ or -.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-name">Display name</FieldLabel>
              <Input id="invite-name" name="displayName" placeholder="Jane Doe" autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" name="email" type="email" placeholder="name@company.com" autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-password">Temporary password</FieldLabel>
              <Input id="invite-password" name="password" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Role</FieldLegend>
              <RadioGroup name="role" defaultValue="VIEWER">
                {(Object.keys(ROLE_META) as Role[]).map((r) => (
                  <Field key={r} orientation="horizontal">
                    <RadioGroupItem value={r} id={`role-${r}`} />
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel htmlFor={`role-${r}`}>{ROLE_META[r].label}</FieldLabel>
                      <FieldDescription>{ROLE_HELP[r]}</FieldDescription>
                    </div>
                  </Field>
                ))}
              </RadioGroup>
            </FieldSet>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={createUser.isPending}>Create user</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
