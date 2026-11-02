import * as React from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import {
  URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT,
  URL_CHECK_AUTO_DISABLE_AFTER_MAX,
  URL_CHECK_MAX_CADENCE_SECONDS,
  URL_CHECK_MIN_CADENCE_SECONDS,
} from "@componode/core";
import { describeApiError, type ApiError } from "@/api/client";
import type { CreateUrlCheckInput } from "@componode/core";
import { useCreateUrlCheck, useUpdateUrlCheck } from "@/api/hooks/url-checks";
import {
  parseStatusesInput,
  statusesInputOf,
  urlCheckAuthConfigOf,
  validateUrlCheckDraft,
} from "@/api/mappers/monitoring";
import { Button } from "@/ux/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ux/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ux/components/ui/select";
import { Switch } from "@/ux/components/ui/switch";
import {
  ENVIRONMENT_META,
  type UrlCheckAuthMode,
  type UrlCheckMethod,
} from "@/ux/lib/domain";
import type {
  Component,
  MonitoringSetupView,
  UrlCheckView,
} from "@/ux/lib/view-types";
import { UrlCheckAuthFields, type HeaderRow } from "./url-check-auth-fields";

const URL_RE = /^https?:\/\//i;

/** env label + optional region so instance options stay distinguishable. */
export function instanceLabel(i: Component["instances"][number]): string {
  const env = ENVIRONMENT_META[i.environment]?.label ?? i.environment;
  return i.region ? `${env} · ${i.region}` : env;
}

export function UrlCheckEditor({
  component,
  check,
  setup,
  trigger,
}: {
  component: Component;
  /** Present = edit mode (PATCH preserves identity + history). */
  check?: UrlCheckView;
  /** Shared setup, used to phrase the cadence-override placeholder. */
  setup?: MonitoringSetupView | null;
  trigger?: React.ReactNode;
}) {
  const isEdit = Boolean(check);
  const create = useCreateUrlCheck(component.id);
  const update = useUpdateUrlCheck();
  const isApi = component.category === "API";

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [instanceId, setInstanceId] = React.useState("");
  const [method, setMethod] = React.useState<UrlCheckMethod>("GET");
  const [enabled, setEnabled] = React.useState(true);
  const [cadenceInput, setCadenceInput] = React.useState("");
  const [statusesInput, setStatusesInput] = React.useState("200-299");
  const [targetInput, setTargetInput] = React.useState("");
  const [targetWindow, setTargetWindow] = React.useState<"24H" | "7D" | "30D">(
    "24H",
  );
  const [autoDisableInput, setAutoDisableInput] = React.useState("");
  const [authMode, setAuthMode] = React.useState<UrlCheckAuthMode>("NONE");
  const [credentialId, setCredentialId] = React.useState("");
  const [usernameKey, setUsernameKey] = React.useState("username");
  const [passwordKey, setPasswordKey] = React.useState("password");
  const [tokenKey, setTokenKey] = React.useState("token");
  const [headers, setHeaders] = React.useState<HeaderRow[]>([
    { name: "", key: "" },
  ]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(check?.name ?? "");
    setUrl(check?.url ?? "");
    setInstanceId(
      check?.componentInstanceId ?? component.instances[0]?.id ?? "",
    );
    setMethod(check?.method ?? "GET");
    setEnabled(check?.enabled ?? true);
    setCadenceInput(
      check?.cadenceSeconds != null ? String(check.cadenceSeconds) : "",
    );
    setStatusesInput(check ? statusesInputOf(check.successPolicy) : "200-299");
    setTargetInput(
      check?.availabilityTarget != null ? String(check.availabilityTarget) : "",
    );
    setTargetWindow(check?.targetWindow ?? "24H");
    setAutoDisableInput(
      check?.autoDisableAfter != null ? String(check.autoDisableAfter) : "",
    );
    setAuthMode(check?.authMode ?? "NONE");
    setCredentialId(check?.credentialId ?? "");
    const cfg = check?.authConfig as Record<string, unknown> | null;
    setUsernameKey(
      typeof cfg?.usernameKey === "string" ? cfg.usernameKey : "username",
    );
    setPasswordKey(
      typeof cfg?.passwordKey === "string" ? cfg.passwordKey : "password",
    );
    setTokenKey(typeof cfg?.tokenKey === "string" ? cfg.tokenKey : "token");
    const cfgHeaders = Array.isArray(
      (cfg as { headers?: HeaderRow[] } | null)?.headers,
    )
      ? (cfg as { headers: HeaderRow[] }).headers
      : null;
    setHeaders(
      cfgHeaders?.length
        ? cfgHeaders.map((h) => ({ name: h.name, key: h.key }))
        : [{ name: "", key: "" }],
    );
    setError(null);
    // Re-seeds the form from `check`/`component.instances` each time the dialog opens.
  }, [open]);

  function validate():
    | {
        error?: string;
        cadenceSeconds: number | null;
        availabilityTarget: number | null;
        autoDisableAfter: number | null;
      }
    | { error: string } {
    if (!name.trim()) return { error: "Name is required." };
    if (!url.trim()) return { error: "URL is required." };
    if (!URL_RE.test(url.trim()))
      return { error: "URL must start with http:// or https://." };
    if (!instanceId) return { error: "Pick the instance this check monitors." };
    let cadenceSeconds: number | null = null;
    if (cadenceInput.trim() !== "") {
      const n = Number(cadenceInput);
      if (
        !Number.isInteger(n) ||
        n < URL_CHECK_MIN_CADENCE_SECONDS ||
        n > URL_CHECK_MAX_CADENCE_SECONDS
      ) {
        return {
          error: `Cadence must be ${URL_CHECK_MIN_CADENCE_SECONDS}–${URL_CHECK_MAX_CADENCE_SECONDS} seconds, or empty to inherit.`,
        };
      }
      cadenceSeconds = n;
    }
    let availabilityTarget: number | null = null;
    if (targetInput.trim() !== "") {
      const t = Number(targetInput);
      if (!Number.isFinite(t) || t < 0 || t > 100)
        return { error: "Availability target must be 0–100." };
      availabilityTarget = t;
    }
    let autoDisableAfter: number | null = null;
    if (autoDisableInput.trim() !== "") {
      const n = Number(autoDisableInput);
      if (
        !Number.isInteger(n) ||
        n < 0 ||
        n > URL_CHECK_AUTO_DISABLE_AFTER_MAX
      ) {
        return {
          error: `Auto-disable must be a whole number 0–${URL_CHECK_AUTO_DISABLE_AFTER_MAX}, or empty to inherit.`,
        };
      }
      autoDisableAfter = n;
    }
    const authError = validateUrlCheckDraft({
      isApi,
      authMode,
      credentialId,
      usernameKey,
      passwordKey,
      tokenKey,
      headers,
    });
    if (authError) return { error: authError };
    return { cadenceSeconds, availabilityTarget, autoDisableAfter };
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const policy = parseStatusesInput(statusesInput);
    if (policy.error || !policy.policy)
      return setError(policy.error ?? "Invalid accepted statuses.");
    const v = validate();
    if ("error" in v && v.error) return setError(v.error);
    const { cadenceSeconds, availabilityTarget, autoDisableAfter } = v as {
      cadenceSeconds: number | null;
      availabilityTarget: number | null;
      autoDisableAfter: number | null;
    };

    const effectiveAuth: UrlCheckAuthMode = isApi ? authMode : "NONE";
    const authConfig = urlCheckAuthConfigOf({
      isApi,
      authMode,
      credentialId,
      usernameKey,
      passwordKey,
      tokenKey,
      headers,
    });

    const body: CreateUrlCheckInput = {
      name: name.trim(),
      url: url.trim(),
      componentInstanceId: instanceId,
      method,
      enabled,
      cadenceSeconds,
      successPolicy: policy.policy,
      availabilityTarget,
      targetWindow: availabilityTarget != null ? targetWindow : null,
      autoDisableAfter,
      authMode: effectiveAuth,
      credentialId: effectiveAuth === "NONE" ? null : credentialId || null,
      authConfig,
    };
    setError(null);

    if (isEdit && check) {
      update.mutate(
        { id: check.id, ...body },
        {
          onSuccess: () => {
            toast.success(`Check ${body.name} updated`);
            setOpen(false);
          },
          onError: (err) =>
            setError(describeApiError(err as unknown as ApiError)),
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          toast.success(`Check ${body.name} created`);
          setOpen(false);
        },
        onError: (err) =>
          setError(describeApiError(err as unknown as ApiError)),
      });
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ??
          (isEdit ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Edit ${check?.name ?? "check"}`}
            >
              <PencilIcon className="size-3.5" />
            </Button>
          ) : (
            <Button variant="outline" size="sm">
              <PlusIcon data-icon="inline-start" />
              Add check
            </Button>
          ))}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `Edit ${check?.name}` : "Add URL check"}
            </DialogTitle>
            <DialogDescription>
              A scheduled HTTP(S) probe against one instance of {component.name}
              . Results never change the instance&apos;s importer-reported
              status.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="uce-name">Name</FieldLabel>
              <Input
                id="uce-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="uce-url">URL</FieldLabel>
              <Input
                id="uce-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                required
                autoComplete="off"
                className="font-mono"
              />
              <FieldDescription>
                Validated against the platform&apos;s URL destination rules at
                save and at probe time.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="uce-instance">Instance</FieldLabel>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger id="uce-instance" className="w-full">
                  <SelectValue placeholder="Select an instance" />
                </SelectTrigger>
                <SelectContent>
                  {component.instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {instanceLabel(i)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                The environment this check monitors.
              </FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="uce-method">Method</FieldLabel>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as UrlCheckMethod)}
                >
                  <SelectTrigger id="uce-method" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="HEAD">HEAD</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="uce-cadence">
                  Cadence override (seconds)
                </FieldLabel>
                <Input
                  id="uce-cadence"
                  value={cadenceInput}
                  onChange={(e) => setCadenceInput(e.target.value)}
                  placeholder={
                    setup
                      ? `Every ${setup.cadenceSeconds}s (default)`
                      : "Inherit default"
                  }
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="uce-statuses">Accepted statuses</FieldLabel>
              <Input
                id="uce-statuses"
                value={statusesInput}
                onChange={(e) => setStatusesInput(e.target.value)}
                placeholder="200-299,301"
                autoComplete="off"
                className="font-mono"
              />
              <FieldDescription>
                Comma-separated codes and ranges — e.g. 200-299,301. Redirects
                are evaluated as returned.
              </FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="uce-target">
                  Availability target (%)
                </FieldLabel>
                <Input
                  id="uce-target"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  placeholder="Optional, e.g. 99.9"
                  inputMode="decimal"
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="uce-target-window">
                  Target window
                </FieldLabel>
                <Select
                  value={targetWindow}
                  onValueChange={(v) =>
                    setTargetWindow(v as "24H" | "7D" | "30D")
                  }
                  disabled={targetInput.trim() === ""}
                >
                  <SelectTrigger id="uce-target-window" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24H">24 hours</SelectItem>
                    <SelectItem value="7D">7 days</SelectItem>
                    <SelectItem value="30D">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field
              orientation="horizontal"
              className="items-center justify-between"
            >
              <FieldLabel htmlFor="uce-enabled">Enabled</FieldLabel>
              <Switch
                id="uce-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Check enabled"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="uce-auto-disable">
                Auto-disable after consecutive failures
              </FieldLabel>
              <Input
                id="uce-auto-disable"
                inputMode="numeric"
                placeholder={`${URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT} (global default)`}
                value={autoDisableInput}
                onChange={(e) => setAutoDisableInput(e.target.value)}
              />
              <FieldDescription>
                Consecutive failed or missed probes before the check disables
                itself. Empty inherits the global default (
                {URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT}); 0 never auto-disables.
              </FieldDescription>
            </Field>
            {isApi && (
              <UrlCheckAuthFields
                idPrefix="uce"
                authMode={authMode}
                setAuthMode={setAuthMode}
                credentialId={credentialId}
                setCredentialId={setCredentialId}
                usernameKey={usernameKey}
                setUsernameKey={setUsernameKey}
                passwordKey={passwordKey}
                setPasswordKey={setPasswordKey}
                tokenKey={tokenKey}
                setTokenKey={setTokenKey}
                headers={headers}
                setHeaders={setHeaders}
              />
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {isEdit ? "Save check" : "Create check"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
