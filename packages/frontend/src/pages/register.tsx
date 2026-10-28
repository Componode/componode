import { AlertCircleIcon } from "lucide-react";
import { PASSWORD_MIN_LENGTH } from "@componode/core";
import { Link, useNavigate } from "react-router-dom";
import * as React from "react";
import { api, type ApiError } from "@/api/client";
import { Logo } from "@/ux/components/app/logo";
import { AuthShowcase } from "@/ux/components/auth/auth-showcase";
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert";
import { Button } from "@/ux/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { Spinner } from "@/ux/components/ui/spinner";

function describeError(err: unknown): string {
  const apiErr = err as ApiError;
  switch (apiErr.code) {
    case "AUTH_RATE_LIMITED":
      return "Too many registration attempts. Please try again later.";
    case "REGISTRATION_DISABLED":
      return "Self-registration is not enabled on this instance.";
    case "USERNAME_TAKEN":
      return "That username is already taken. Please choose another.";
    default:
      return apiErr.message ?? "An error occurred. Please try again.";
  }
}

type Errors = Partial<Record<"username" | "password" | "form", string>>;

export function RegisterPage() {
  const navigate = useNavigate();
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Errors>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const displayName = String(data.get("displayName") ?? "").trim();
    const next: Errors = {};
    if (!username) next.username = "Choose a username.";
    if (!password) next.password = "Choose a password.";
    else if (password.length < PASSWORD_MIN_LENGTH) next.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    setErrors(next);
    if (Object.keys(next).length) return;

    setPending(true);
    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password, displayName: displayName || undefined }),
      });
      navigate("/", { replace: true });
    } catch (err) {
      setErrors({ form: describeError(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col gap-10 px-6 py-8 md:px-12">
        <Logo />
        <main id="main" className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-sm flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
              <p className="text-sm text-muted-foreground">Register a new Componode account.</p>
            </div>

            {errors.form && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Registration failed</AlertTitle>
                <AlertDescription>{errors.form}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <Field data-invalid={!!errors.username || undefined}>
                  <FieldLabel htmlFor="username">Username</FieldLabel>
                  <Input id="username" name="username" autoComplete="username" autoFocus aria-invalid={!!errors.username} />
                  {errors.username ? (
                    <FieldError>{errors.username}</FieldError>
                  ) : (
                    <FieldDescription>Lowercase letters, digits, _ and -.</FieldDescription>
                  )}
                </Field>
                <Field data-invalid={!!errors.password || undefined}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input id="password" name="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} />
                  {errors.password ? (
                    <FieldError>{errors.password}</FieldError>
                  ) : (
                    <FieldDescription>{`${PASSWORD_MIN_LENGTH}+ characters.`}</FieldDescription>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="displayName">Display name</FieldLabel>
                  <Input id="displayName" name="displayName" autoComplete="name" />
                  <FieldDescription>Optional — how you appear to teammates.</FieldDescription>
                </Field>
                <Button type="submit" size="lg" disabled={pending}>
                  {pending && <Spinner data-icon="inline-start" />}
                  Create account
                </Button>
              </FieldGroup>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Componode DPAM · self-hosted</span>
        </footer>
      </div>
      <AuthShowcase />
    </div>
  );
}
