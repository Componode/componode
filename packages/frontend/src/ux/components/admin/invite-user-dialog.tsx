
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
import { ROLE_META, type Role } from "@/ux/lib/domain"

const ROLE_HELP: Record<Role, string> = {
  VIEWER: "Read the catalog. Cannot change anything.",
  EDITOR: "Edit products, components and run importers.",
  ADMIN: "Everything, plus users, credentials and workspace settings.",
}

/** Standard create-dialog pattern: ≤ 4 fields, primary action on the right, closes + toasts on success. */
export function InviteUserDialog() {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon data-icon="inline-start" />
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            const email = new FormData(e.currentTarget).get("email")
            setOpen(false)
            toast.success(`Invitation sent to ${email}`)
          }}
        >
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>They will receive an email with a link valid for 7 days.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-email">Work email</FieldLabel>
              <Input id="invite-email" name="email" type="email" required placeholder="name@company.com" autoComplete="off" />
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
            <Button type="submit">Send invite</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
