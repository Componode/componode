
import { Link } from "react-router-dom"
import * as React from "react"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Spinner } from "@/ux/components/ui/spinner"

/** Card section for a form page. One concern per section; the title says which. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">{children}</CardContent>
    </Card>
  )
}

/**
 * Form page wrapper. Rules:
 * - Cancel is a link back to where the user came from, never a silent reset.
 * - The primary action is last and shows a spinner while pending.
 * - The action bar sticks to the bottom so long forms never hide Save.
 */
export function FormPage({
  onSubmit,
  cancelHref,
  submitLabel,
  pending,
  disabled,
  children,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  cancelHref: string
  submitLabel: string
  pending?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {children}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <Button variant="outline" asChild>
          <Link to={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={pending || disabled}>
          {pending && <Spinner data-icon="inline-start" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
