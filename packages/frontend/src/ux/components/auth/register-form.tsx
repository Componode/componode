
import { CheckIcon, InfoIcon, XIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { Alert, AlertDescription } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Spinner } from "@/ux/components/ui/spinner"
import { cn } from "@/ux/lib/utils"
import { ux } from "@/ux/lib/paths"

const RULES = [
  { id: "len", label: "At least 12 characters", test: (v: string) => v.length >= 12 },
  { id: "mix", label: "Upper and lower case letters", test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: "num", label: "A number or symbol", test: (v: string) => /[\d\W]/.test(v) },
]

export function RegisterForm() {
  const navigate = useNavigate()
  const [password, setPassword] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const next: Record<string, string> = {}
    if (!String(data.get("displayName") ?? "").trim()) next.displayName = "Enter your name."
    if (!/^[a-z0-9._-]{3,}$/.test(String(data.get("username") ?? ""))) next.username = "Use 3+ lowercase letters, numbers, dots or dashes."
    if (!/^\S+@\S+\.\S+$/.test(String(data.get("email") ?? ""))) next.email = "Enter a valid work email."
    if (!RULES.every((r) => r.test(password))) next.password = "Password doesn’t meet the requirements."
    setErrors(next)
    if (Object.keys(next).length) return
    setPending(true)
    setTimeout(() => navigate("/"), 700)
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">You&apos;ll join the Halcyon workspace.</p>
      </div>

      <Alert>
        <InfoIcon />
        <AlertDescription>
          New accounts start as <strong className="font-medium text-foreground">Viewer</strong>. An admin can grant Editor
          or Admin access.
        </AlertDescription>
      </Alert>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.displayName || undefined}>
            <FieldLabel htmlFor="displayName">Full name</FieldLabel>
            <Input id="displayName" name="displayName" autoComplete="name" autoFocus aria-invalid={!!errors.displayName} />
            {errors.displayName && <FieldError>{errors.displayName}</FieldError>}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.username || undefined}>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input id="username" name="username" autoComplete="username" aria-invalid={!!errors.username} />
              {errors.username && <FieldError>{errors.username}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.email || undefined}>
              <FieldLabel htmlFor="email">Work email</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" aria-invalid={!!errors.email} />
              {errors.email && <FieldError>{errors.email}</FieldError>}
            </Field>
          </div>
          <Field data-invalid={!!errors.password || undefined}>
            <FieldLabel htmlFor="new-password">Password</FieldLabel>
            <Input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby="password-rules"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <ul id="password-rules" className="flex flex-col gap-1">
              {RULES.map((rule) => {
                const ok = rule.test(password)
                return (
                  <li key={rule.id} className={cn("flex items-center gap-1.5 text-xs", ok ? "text-success" : "text-muted-foreground")}>
                    {ok ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <XIcon className="size-3.5" aria-hidden="true" />}
                    {rule.label}
                    <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
                  </li>
                )
              })}
            </ul>
            {errors.password && <FieldError>{errors.password}</FieldError>}
          </Field>
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? "Creating account…" : "Create account"}
          </Button>
          <FieldDescription className="text-center">
            By continuing you agree to your organization&apos;s acceptable use policy.
          </FieldDescription>
        </FieldGroup>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to={ux("/login")} className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
