
import { AlertCircleIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Checkbox } from "@/ux/components/ui/checkbox"
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ux/components/ui/input-group"
import { Spinner } from "@/ux/components/ui/spinner"
import { ux } from "@/ux/lib/paths"

type Errors = Partial<Record<"username" | "password" | "form", string>>

export function LoginForm() {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [errors, setErrors] = React.useState<Errors>({})

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const username = String(data.get("username") ?? "").trim()
    const password = String(data.get("password") ?? "")
    const next: Errors = {}
    if (!username) next.username = "Enter your username or email."
    if (!password) next.password = "Enter your password."
    if (username && password === "wrong") next.form = "Username or password is incorrect."
    setErrors(next)
    if (Object.keys(next).length) return
    setPending(true)
    setTimeout(() => navigate("/"), 700)
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Componode</h1>
        <p className="text-sm text-muted-foreground">Use your workspace account or single sign-on.</p>
        <p className="rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Design prototype. Any username and password will sign you in, and no session is created.
        </p>
      </div>

      {errors.form && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Couldn&apos;t sign you in</AlertTitle>
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.username || undefined}>
            <FieldLabel htmlFor="username">Username or email</FieldLabel>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              aria-invalid={!!errors.username}
              placeholder="amira.k"
            />
            {errors.username && <FieldError>{errors.username}</FieldError>}
          </Field>
          <Field data-invalid={!!errors.password || undefined}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
            </div>
            <InputGroup>
              <InputGroupInput
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                aria-invalid={!!errors.password}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {errors.password && <FieldError>{errors.password}</FieldError>}
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="remember" name="remember" defaultChecked />
            <FieldLabel htmlFor="remember" className="font-normal">
              Keep me signed in for 30 days
            </FieldLabel>
          </Field>
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <FieldSeparator>or</FieldSeparator>
          <Button type="button" variant="outline" size="lg" onClick={() => navigate("/")}>
            <KeyRoundIcon data-icon="inline-start" />
            Continue with SSO
          </Button>
        </FieldGroup>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New to this workspace?{" "}
        <Link to={ux("/register")} className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  )
}
