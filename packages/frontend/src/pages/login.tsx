import { AlertCircleIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as React from "react";
import { useLogin } from "@/api/hooks/auth";
import { useOidcStatus } from "@/api/hooks/settings";
import type { ApiError } from "@/api/client";
import { Logo } from "@/ux/components/app/logo";
import { AuthShowcase } from "@/ux/components/auth/auth-showcase";
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert";
import { Button } from "@/ux/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ux/components/ui/input-group";
import { Spinner } from "@/ux/components/ui/spinner";

type Errors = Partial<Record<"username" | "password" | "form", string>>;

const OIDC_ERROR_COPY: Record<string, string> = {
  oidc_access_denied: "Your identity provider denied the sign-in request.",
  oidc_invalid_state: "The sign-in request expired or was tampered with. Start again.",
  oidc_no_account: "Your identity provider verified you, but no Componode account matches. Ask an administrator.",
};

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const oidc = useOidcStatus();
  const urlError = useSearchParams()[0].get("error");
  const [showPassword, setShowPassword] = React.useState(false);
  const [errors, setErrors] = React.useState<Errors>({});

  const formError =
    errors.form ?? (urlError ? OIDC_ERROR_COPY[urlError] ?? "Single sign-on failed. Try again or use your password." : null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const next: Errors = {};
    if (!username) next.username = "Enter your username.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    if (Object.keys(next).length) return;

    login.mutate(
      { username, password },
      {
        onSuccess: () => navigate("/"),
        onError: (err) => {
          const code = (err as unknown as ApiError).code;
          setErrors({
            form:
              code === "AUTH_RATE_LIMITED"
                ? "Too many sign-in attempts. Try again later."
                : code === "AUTH_INVALID_CREDENTIALS"
                  ? "Username or password is incorrect."
                  : "Sign-in failed. Please try again.",
          });
        },
      },
    );
  }

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col gap-10 px-6 py-8 md:px-12">
        <Logo />
        <main id="main" className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-sm flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Sign in to Componode</h1>
              <p className="text-sm text-muted-foreground">Use your workspace account or single sign-on.</p>
            </div>

            {formError && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Couldn&apos;t sign you in</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <Field data-invalid={!!errors.username || undefined}>
                  <FieldLabel htmlFor="username">Username</FieldLabel>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoFocus
                    aria-invalid={!!errors.username}
                  />
                  {errors.username && <FieldError>{errors.username}</FieldError>}
                </Field>
                <Field data-invalid={!!errors.password || undefined}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
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
                <Button type="submit" size="lg" disabled={login.isPending}>
                  {login.isPending && <Spinner data-icon="inline-start" />}
                  Sign in
                </Button>
                {oidc.data?.enabled && (
                  <>
                    <FieldSeparator>or</FieldSeparator>
                    <Button type="button" variant="outline" size="lg" asChild>
                      <a href="/api/v1/auth/oidc/login">
                        <KeyRoundIcon data-icon="inline-start" />
                        Continue with SSO
                      </a>
                    </Button>
                  </>
                )}
              </FieldGroup>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              New to this workspace?{" "}
              <Link to="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
                Create an account
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
