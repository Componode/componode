import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2Icon, CircleAlertIcon, Loader2Icon } from "lucide-react";
import { useCredentials } from "@/api/hooks/credentials";
import { useCreateCredential } from "@/api/hooks/credentials";
import { useCreateImporterConfig } from "@/api/hooks/importers";
import { useProbeDockerTarget } from "@/api/hooks/docker-targets";
import { useCreateDockerTarget } from "@/api/hooks/docker-targets";
import { describeApiError, type ApiError } from "@/api/client";
import type { CredentialListItem } from "@/api/types";
import {
  DOCKER_SETUP_SCHEDULES,
  DOCKER_SETUP_TRANSPORTS,
  TRANSPORT_SECRET_KEYS,
  buildTargetProfile,
  credentialCoversKeys,
  isSecretRefField,
  suggestTargetId,
  transportSecretKeys,
  type SetupTransport,
} from "@/ux/components/importers/docker-setup-logic";
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert";
import { Button } from "@/ux/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Checkbox } from "@/ux/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { Textarea } from "@/ux/components/ui/textarea";
import { ux } from "@/ux/lib/paths";

type Step = "route" | "secrets" | "identity" | "create";

const STEP_ORDER: Step[] = ["route", "secrets", "identity", "create"];
const STEP_TITLES: Record<Step, string> = {
  route: "Connection",
  secrets: "Secrets",
  identity: "Name & schedule",
  create: "Verify & create",
};

const SECRET_LABELS: Record<string, string> = {
  caCert: "CA certificate (PEM)",
  clientCert: "Client certificate (PEM)",
  clientKey: "Client private key (PEM)",
  sshPrivateKey: "SSH private key (PEM/OpenSSH)",
  sshPassphrase: "Key passphrase",
};

interface Artifacts {
  targetRowId?: string;
  credentialId?: string;
  configId?: string;
}

interface StepStatus {
  label: string;
  state: "pending" | "active" | "done" | "error";
}

export function DockerSetupWizard() {
  const navigate = useNavigate();
  const credentials = useCredentials();
  const createTarget = useCreateDockerTarget();
  const createCredential = useCreateCredential();
  const createConfig = useCreateImporterConfig();
  const probe = useProbeDockerTarget();

  const [transport, setTransport] = React.useState<SetupTransport>("socket");
  const [routeFields, setRouteFields] = React.useState<Record<string, string>>({});
  const [secretMode, setSecretMode] = React.useState<"new" | "reuse">("new");
  const [secretValues, setSecretValues] = React.useState<Record<string, string>>({});
  const [credentialLabel, setCredentialLabel] = React.useState("");
  const [reuseCredentialId, setReuseCredentialId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [targetId, setTargetId] = React.useState("");
  const [targetIdTouched, setTargetIdTouched] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [schedule, setSchedule] = React.useState<string>("0 */6 * * *");
  const [enabled, setEnabled] = React.useState(true);

  const [step, setStep] = React.useState<Step>("route");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [running, setRunning] = React.useState(false);
  const [steps, setSteps] = React.useState<StepStatus[]>([]);
  const [failure, setFailure] = React.useState<{ step: string; message: string } | null>(null);
  const [artifacts, setArtifacts] = React.useState<Artifacts>({});

  const transportDef = DOCKER_SETUP_TRANSPORTS.find((t) => t.value === transport)!;
  const secretSpec = TRANSPORT_SECRET_KEYS[transport];
  const allSecretKeys = transportSecretKeys(transport);
  const needsSecrets = allSecretKeys.length > 0;
  const requiredSecretKeys = secretSpec.required;

  const typedSecretKeys = allSecretKeys.filter((k) => (secretValues[k] ?? "").trim().length > 0);

  const reuseCandidates = React.useMemo(() => {
    if (!needsSecrets) return [];
    return (credentials.data?.credentials ?? []).filter(
      (c: CredentialListItem) =>
        c.kind === "STORED" && c.status === "ACTIVE" && credentialCoversKeys(c.keyHints, requiredSecretKeys),
    );
  }, [credentials.data, needsSecrets, requiredSecretKeys]);

  const usingReuse = needsSecrets && secretMode === "reuse" && reuseCredentialId.length > 0;
  const reuseCredential = reuseCandidates.find((c) => c.id === reuseCredentialId);

  // Reuse mode emits *Key refs for every canonical key the selected
  // credential covers — required keys always, optional keys only when the
  // credential actually has them (a dangling ref would fail coverage).
  const providedSecretKeys = usingReuse
    ? allSecretKeys.filter((k) => credentialCoversKeys(reuseCredential?.keyHints, [k]))
    : typedSecretKeys;
  const profile = buildTargetProfile(transport, routeFields, providedSecretKeys);

  // Suggested targetId tracks label/host until the user edits it.
  React.useEffect(() => {
    if (!targetIdTouched) {
      const host = routeFields.host ?? routeFields.name;
      setTargetId(suggestTargetId(label, host));
    }
  }, [label, routeFields.host, routeFields.name, targetIdTouched]);

  const routeFieldsForInput = transportDef.fields.filter((f) => !isSecretRefField(transport, f.key));

  const validateStep = (s: Step): boolean => {
    const e: Record<string, string> = {};
    if (s === "route") {
      for (const f of transportDef.fields) {
        if (isSecretRefField(transport, f.key)) continue;
        const raw = (routeFields[f.key] ?? "").trim();
        if (f.required && !raw) e[f.key] = `${f.label} is required.`;
        else if (f.number && raw && !/^\d+$/.test(raw)) e[f.key] = `${f.label} must be a number.`;
      }
    }
    if (s === "secrets" && needsSecrets) {
      if (secretMode === "reuse") {
        if (!reuseCredentialId) e.credential = "Select a credential to reuse.";
      } else {
        for (const k of requiredSecretKeys) {
          if (!(secretValues[k] ?? "").trim()) e[`secret.${k}`] = `${SECRET_LABELS[k] ?? k} is required.`;
        }
      }
    }
    if (s === "identity") {
      if (!label.trim()) e.label = "Importer label is required.";
      if (!targetId.trim()) e.targetId = "Target ID is required.";
      else if (targetId.trim().length > 200) e.targetId = "Target ID must be 200 characters or fewer.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const visibleSteps = STEP_ORDER.filter((s) => s !== "secrets" || needsSecrets);

  const goNext = () => {
    if (!validateStep(step)) return;
    const pos = visibleSteps.indexOf(step);
    const next = visibleSteps[pos + 1];
    if (next) setStep(next);
  };

  const goBack = () => {
    const pos = visibleSteps.indexOf(step);
    const prev = pos > 0 ? visibleSteps[pos - 1] : undefined;
    if (prev) setStep(prev);
  };

  const setStepState = (labelText: string, state: StepStatus["state"]) =>
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.label === labelText);
      if (i >= 0) return prev.map((s, j) => (j === i ? { ...s, state } : s));
      return [...prev, { label: labelText, state }];
    });

  const runCreate = async () => {
    if (!profile || running) return;
    setRunning(true);
    setFailure(null);
    setSteps([]);
    const secretsPayload =
      needsSecrets && !usingReuse
        ? Object.fromEntries(providedSecretKeys.map((k) => [k, (secretValues[k] ?? "").trim()]))
        : undefined;
    const probeBody = usingReuse
      ? { profile, credentialId: reuseCredentialId }
      : secretsPayload
        ? { profile, secrets: secretsPayload }
        : { profile };

    // 1 — probe (stateless, nothing persisted yet)
    setStepState("Verify connection", "active");
    try {
      const res = await probe.mutateAsync(probeBody);
      if (!res.ok) {
        setStepState("Verify connection", "error");
        setFailure({ step: "Verify connection", message: res.error ?? "The probe did not succeed." });
        setRunning(false);
        return;
      }
      setStepState("Verify connection", "done");
    } catch (e) {
      setStepState("Verify connection", "error");
      setFailure({ step: "Verify connection", message: describeApiError(e as ApiError) });
      setRunning(false);
      return;
    }

    // 2 — create target (skipped on retry if already created)
    let targetRowId = artifacts.targetRowId;
    if (!targetRowId) {
      setStepState("Create Docker target", "active");
      try {
        const t = await createTarget.mutateAsync({
          targetId: targetId.trim(),
          label: label.trim(),
          description: description.trim() || undefined,
          profile,
        });
        targetRowId = t.target.id;
        setArtifacts((a) => ({ ...a, targetRowId }));
        setStepState("Create Docker target", "done");
      } catch (e) {
        setStepState("Create Docker target", "error");
        setFailure({ step: "Create Docker target", message: describeApiError(e as ApiError) });
        setRunning(false);
        return;
      }
    } else {
      setStepState("Create Docker target", "done");
    }

    // 3 — create credential (only when entering new secret values)
    let credentialId = artifacts.credentialId ?? (usingReuse ? reuseCredentialId : undefined);
    if (!credentialId && needsSecrets && !usingReuse && secretsPayload) {
      setStepState("Store secrets as credential", "active");
      try {
        const c = await createCredential.mutateAsync({
          kind: "STORED",
          label: credentialLabel.trim() || `Docker — ${label.trim()}`,
          secrets: secretsPayload,
        });
        credentialId = c.credential.id;
        setArtifacts((a) => ({ ...a, credentialId }));
        setStepState("Store secrets as credential", "done");
      } catch (e) {
        setStepState("Store secrets as credential", "error");
        setFailure({ step: "Store secrets as credential", message: describeApiError(e as ApiError) });
        setRunning(false);
        return;
      }
    } else if (credentialId) {
      setStepState("Store secrets as credential", "done");
    }

    // 4 — create importer config
    if (!artifacts.configId) {
      setStepState("Create importer", "active");
      try {
        const cfg = await createConfig.mutateAsync({
          importerName: "docker",
          label: label.trim(),
          scope: { targetId: targetId.trim() },
          secretRefs: [],
          credentialIds: credentialId ? [credentialId] : [],
          agentId: null,
          schedule: schedule === "manual" ? null : schedule,
          enabled,
        });
        setArtifacts((a) => ({ ...a, configId: cfg.config.id }));
        setStepState("Create importer", "done");
        setRunning(false);
        navigate(ux(`/importers/${cfg.config.id}`));
        return;
      } catch (e) {
        setStepState("Create importer", "error");
        setFailure({ step: "Create importer", message: describeApiError(e as ApiError) });
        setRunning(false);
        return;
      }
    }
    setRunning(false);
  };

  const stepIndex = visibleSteps.indexOf(step);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Guided Docker setup</CardTitle>
        <p className="text-sm text-muted-foreground">
          Step {stepIndex + 1} of {visibleSteps.length}: {STEP_TITLES[step]}
        </p>
      </CardHeader>
      <CardContent className="grid gap-5">
        {step === "route" && (
          <>
            <FieldGroup>
              <Field>
                <FieldLabel>Connection type</FieldLabel>
                <Select value={transport} onValueChange={(v) => { setTransport(v as SetupTransport); setRouteFields({}); setSecretValues({}); setReuseCredentialId(""); setSecretMode("new"); setErrors({}); }}>
                  <SelectTrigger id="ds-transport" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOCKER_SETUP_TRANSPORTS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{transportDef.description}</FieldDescription>
              </Field>
            </FieldGroup>
            {transportDef.guidance && (
              <Alert>
                <CircleAlertIcon />
                <AlertTitle>Before you continue</AlertTitle>
                <AlertDescription>{transportDef.guidance}</AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              {routeFieldsForInput.map((f) => (
                <Field key={f.key} data-invalid={errors[f.key] ? true : undefined}>
                  <FieldLabel htmlFor={`ds-${f.key}`}>{f.label}{f.required ? "" : " (optional)"}</FieldLabel>
                  <Input
                    id={`ds-${f.key}`}
                    value={routeFields[f.key] ?? ""}
                    placeholder={f.placeholder}
                    inputMode={f.number ? "numeric" : undefined}
                    onChange={(e) => setRouteFields((r) => ({ ...r, [f.key]: e.target.value }))}
                    aria-invalid={errors[f.key] ? true : undefined}
                  />
                  {errors[f.key] ? <FieldError>{errors[f.key]}</FieldError> : f.hint ? <FieldDescription>{f.hint}</FieldDescription> : null}
                </Field>
              ))}
            </FieldGroup>
          </>
        )}

        {step === "secrets" && needsSecrets && (
          <>
            {reuseCandidates.length > 0 && (
              <FieldGroup>
                <Field>
                  <FieldLabel>Secret source</FieldLabel>
                  <Select value={secretMode} onValueChange={(v) => setSecretMode(v as "new" | "reuse")}>
                    <SelectTrigger id="ds-secretmode" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Enter new values (stored as a new credential)</SelectItem>
                      <SelectItem value="reuse">Reuse an existing credential</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            )}
            {secretMode === "reuse" ? (
              <FieldGroup>
                <Field data-invalid={errors.credential ? true : undefined}>
                  <FieldLabel>Credential</FieldLabel>
                  <Select value={reuseCredentialId} onValueChange={setReuseCredentialId}>
                    <SelectTrigger id="ds-reusecred" className="w-full"><SelectValue placeholder="Select a credential" /></SelectTrigger>
                    <SelectContent>
                      {reuseCandidates.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Only credentials that already contain every required key are listed. Values are never shown.</FieldDescription>
                  {errors.credential ? <FieldError>{errors.credential}</FieldError> : null}
                </Field>
              </FieldGroup>
            ) : (
              <FieldGroup>
                <Alert>
                  <AlertDescription>
                    Values are encrypted at rest and write-only — they are sent once to the probe and stored credential, never logged or shown again.
                  </AlertDescription>
                </Alert>
                <Field>
                  <FieldLabel htmlFor="ds-credlabel">Credential name</FieldLabel>
                  <Input
                    id="ds-credlabel"
                    value={credentialLabel}
                    onChange={(e) => setCredentialLabel(e.target.value)}
                    placeholder={`Docker — ${label.trim() || "importer"}`}
                  />
                  <FieldDescription>Stored encrypted under this name — editable later under Credentials.</FieldDescription>
                </Field>
                {[...requiredSecretKeys, ...secretSpec.optional].map((k) => {
                  const required = requiredSecretKeys.includes(k);
                  return (
                    <Field key={k} data-invalid={errors[`secret.${k}`] ? true : undefined}>
                      <FieldLabel htmlFor={`ds-sec-${k}`}>{SECRET_LABELS[k] ?? k}{required ? "" : " (optional)"}</FieldLabel>
                      <Input
                        id={`ds-sec-${k}`}
                        type="password"
                        autoComplete="off"
                        value={secretValues[k] ?? ""}
                        onChange={(e) => setSecretValues((s) => ({ ...s, [k]: e.target.value }))}
                        aria-invalid={errors[`secret.${k}`] ? true : undefined}
                      />
                      {errors[`secret.${k}`] ? <FieldError>{errors[`secret.${k}`]}</FieldError> : null}
                    </Field>
                  );
                })}
              </FieldGroup>
            )}
          </>
        )}

        {step === "identity" && (
          <FieldGroup>
            <Field data-invalid={errors.label ? true : undefined}>
              <FieldLabel htmlFor="ds-label">Importer label</FieldLabel>
              <Input id="ds-label" value={label} onChange={(e) => setLabel(e.target.value)} aria-invalid={errors.label ? true : undefined} placeholder="Production Docker engine" />
              {errors.label ? <FieldError>{errors.label}</FieldError> : null}
            </Field>
            <Field data-invalid={errors.targetId ? true : undefined}>
              <FieldLabel htmlFor="ds-targetid">Target ID</FieldLabel>
              <Input
                id="ds-targetid"
                value={targetId}
                onChange={(e) => { setTargetIdTouched(true); setTargetId(e.target.value); }}
                aria-invalid={errors.targetId ? true : undefined}
                className="font-mono"
                disabled={Boolean(artifacts.targetRowId)}
              />
              {errors.targetId ? <FieldError>{errors.targetId}</FieldError> : artifacts.targetRowId ? (
                <FieldDescription>This target was already created — its selector is immutable. Delete it under Administration → Docker targets to start over.</FieldDescription>
              ) : (
                <FieldDescription>Suggested from your label — editable now, immutable after creation. Changing engines later means a new target.</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="ds-desc">Description (optional)</FieldLabel>
              <Textarea id="ds-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ds-schedule">Run</FieldLabel>
              <Select value={schedule} onValueChange={setSchedule}>
                <SelectTrigger id="ds-schedule" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCKER_SETUP_SCHEDULES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="ds-enabled" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              <FieldLabel htmlFor="ds-enabled">Enabled — start importing on the schedule</FieldLabel>
            </Field>
          </FieldGroup>
        )}

        {step === "create" && (
          <div className="grid gap-4">
            <ul className="grid gap-2">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-sm">
                  {s.state === "done" && <CheckCircle2Icon className="size-4 text-green-600" />}
                  {s.state === "active" && <Loader2Icon className="size-4 animate-spin" />}
                  {s.state === "error" && <CircleAlertIcon className="size-4 text-destructive" />}
                  {s.state === "pending" && <span className="inline-block size-4 rounded-full border" />}
                  <span className={s.state === "error" ? "text-destructive" : undefined}>{s.label}</span>
                </li>
              ))}
              {steps.length === 0 && !running && (
                <li className="text-sm text-muted-foreground">
                  Ready to verify the connection and create the target, credential, and importer.
                </li>
              )}
            </ul>
            {failure && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{failure.step} failed</AlertTitle>
                <AlertDescription className="grid gap-2">
                  <span>{failure.message}</span>
                  <span>
                    Completed steps are kept — use Retry to continue, or finish manually:{" "}
                    {artifacts.targetRowId && <Link className="underline" to={ux(`/docker-targets/${artifacts.targetRowId}`)}>target</Link>}
                    {artifacts.targetRowId && artifacts.credentialId && " · "}
                    {artifacts.credentialId && <Link className="underline" to={ux(`/credentials/${artifacts.credentialId}`)}>credential</Link>}
                    {artifacts.configId && <Link className="underline" to={ux(`/importers/${artifacts.configId}`)}>importer</Link>}
                  </span>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={goBack} disabled={step === "route" || running}>
            Back
          </Button>
          {step !== "create" ? (
            <Button onClick={goNext}>Next</Button>
          ) : (
            <Button onClick={() => void runCreate()} disabled={running || !profile}>
              {running ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              {failure ? "Retry" : "Verify & create"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
