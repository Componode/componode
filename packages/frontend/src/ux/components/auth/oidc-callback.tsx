
import { CircleAlertIcon, Loader2Icon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate, useSearchParams } from "react-router-dom"
import * as React from "react"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { ux } from "@/ux/lib/paths"

const ERROR_COPY: Record<string, string> = {
  access_denied: "Your identity provider denied the sign-in request.",
  invalid_state: "The sign-in request expired or was tampered with. Start again from the sign-in page.",
  no_account: "Your identity provider verified you, but no Componode account matches. Ask an administrator to invite you.",
}

export function OidcCallback() {
  const navigate = useNavigate()
  const error = useSearchParams()[0].get("error")

  React.useEffect(() => {
    if (error) return
    const timer = setTimeout(() => navigate("/"), 1200)
    return () => clearTimeout(timer)
  }, [error, navigate])

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Single sign-on failed</h1>
          <p className="text-sm text-muted-foreground">We couldn&apos;t complete the sign-in.</p>
        </div>
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Sign-in was not completed</AlertTitle>
          <AlertDescription>{ERROR_COPY[error] ?? "The identity provider returned an unexpected error."}</AlertDescription>
        </Alert>
        <Button asChild>
          <Link to={ux("/login")}>Back to sign in</Link>
        </Button>
      </div>
    )
  }

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-8 text-center">
      <Loader2Icon className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Completing login…</p>
    </div>
  )
}
