
import * as React from "react"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Spinner } from "@/ux/components/ui/spinner"
import { cn } from "@/ux/lib/utils"

interface SettingsSectionProps {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  /** Called with the section's FormData; wire to a real mutation. Omit for instant-save toggles. */
  onSave?: (formData: FormData) => void
  /** Disables the submit button while the mutation is in flight. */
  pending?: boolean
  saveLabel?: string
  footerNote?: React.ReactNode
  tone?: "default" | "destructive"
}

/**
 * The single building block of every settings page.
 * Rules: one Card per concern · explicit Save only when the section has text inputs ·
 * Save is disabled until something changes · toggles save instantly with a toast.
 */
export function SettingsSection({
  title,
  description,
  children,
  onSave,
  saveLabel = "Save changes",
  footerNote,
  tone = "default",
  pending = false,
}: SettingsSectionProps) {
  const [dirty, setDirty] = React.useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSave?.(new FormData(e.currentTarget))
    setDirty(false)
  }

  return (
    <Card className={cn(tone === "destructive" && "border-destructive/40")}>
      <form onSubmit={handleSubmit} onChange={() => setDirty(true)} className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className={cn(tone === "destructive" && "text-destructive")}>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
        {(onSave || footerNote) && (
          <CardFooter className="justify-between gap-4 border-t">
            <p className="text-sm text-muted-foreground">{footerNote}</p>
            {onSave && (
              <Button type="submit" disabled={!dirty || pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {saveLabel}
              </Button>
            )}
          </CardFooter>
        )}
      </form>
    </Card>
  )
}

/** A label + description on the left, a control on the right. Use inside a SettingsSection for toggles/selects. */
export function SettingRow({
  id,
  label,
  description,
  control,
}: {
  id: string
  label: string
  description?: string
  control: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
