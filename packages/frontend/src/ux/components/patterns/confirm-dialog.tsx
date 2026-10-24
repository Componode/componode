
import * as React from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ux/components/ui/alert-dialog"
import { Field, FieldDescription, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"

interface ConfirmDialogProps {
  trigger: React.ReactNode
  title: string
  description: React.ReactNode
  confirmLabel: string
  /** When set, the user must type this exact value. Use for irreversible deletes. */
  typeToConfirm?: string
  onConfirm: () => void
}

/**
 * Destructive confirmation. Rules:
 * – Title states the action and the object ("Revoke AWS prod read-only?").
 * – Description states the consequence, not "Are you sure?".
 * – Confirm button repeats the verb. Cancel is always focused first.
 */
export function ConfirmDialog({ trigger, title, description, confirmLabel, typeToConfirm, onConfirm }: ConfirmDialogProps) {
  const [value, setValue] = React.useState("")
  const blocked = typeToConfirm !== undefined && value !== typeToConfirm
  return (
    <AlertDialog onOpenChange={(open) => !open && setValue("")}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {typeToConfirm !== undefined && (
          <Field>
            <FieldLabel htmlFor="confirm-input">
              Type <code className="rounded bg-muted px-1 font-mono text-xs">{typeToConfirm}</code> to confirm
            </FieldLabel>
            <Input id="confirm-input" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
            <FieldDescription>This action cannot be undone.</FieldDescription>
          </Field>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={blocked} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
