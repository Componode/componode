import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { BanIcon, CircleCheckIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { useDeleteDockerTarget, useDockerTarget, useSetDockerTargetEnabled, useTestDockerTarget, useUpdateDockerTarget } from "@/api/hooks/docker-targets";
import { useImporterConfigs } from "@/api/hooks/importers";
import { errorMessage } from "@/ux/lib/api-state";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog";
import { DescriptionList } from "@/ux/components/patterns/primitives";
import { StatusBadge } from "@/ux/components/patterns/status-badge";
import { Button } from "@/ux/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Field, FieldLabel } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { Textarea } from "@/ux/components/ui/textarea";
import { formatDateTime } from "@/ux/lib/format";
import { ux } from "@/ux/lib/paths";

const NONE = "__none__";

export function UxDockerTargetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const target = useDockerTarget(id);
  const configs = useImporterConfigs();
  const update = useUpdateDockerTarget(id!);
  const setEnabled = useSetDockerTargetEnabled(id!);
  const del = useDeleteDockerTarget(id!);
  const test = useTestDockerTarget(id!);
  const [label, setLabel] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState<string | null>(null);
  const [testConfig, setTestConfig] = React.useState<string>(NONE);

  if (target.isPending) return <PageContainer><Card className="py-0"><TableSkeleton rows={4} columns={2} /></Card></PageContainer>;
  if (target.error) return <PageContainer><ErrorState description={errorMessage(target.error)} onRetry={() => void target.refetch()} /></PageContainer>;
  const t = target.data.target;
  const needsCredential = Object.keys(t.profile).some((k) => k.endsWith("Key"));
  const hubConfigs = (configs.data?.configs ?? []).filter(
    (c) => c.importerName === "docker" && c.agentId === null && (c.scope as { targetId?: string }).targetId === t.targetId,
  );

  return (
    <PageContainer>
      <PageHeader
        title={t.label}
        description={<span className="font-mono text-sm">{t.targetId}</span>}
        meta={<StatusBadge tone={t.enabled ? "success" : "warning"} label={t.enabled ? "Enabled" : "Disabled"} />}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!t.enabled || test.isPending || (needsCredential && testConfig === NONE && hubConfigs.length === 0)}
              onClick={() => test.mutate(needsCredential ? (testConfig !== NONE ? testConfig : hubConfigs[0]?.id) : undefined, {
                onSuccess: (r) => (r.ok ? toast.success("Docker engine is reachable") : toast.error(`Test failed: ${r.error}`)),
                onError: (e) => toast.error(errorMessage(e)),
              })}
            >
              <ZapIcon data-icon="inline-start" />
              {test.isPending ? "Testing…" : "Test connection"}
            </Button>
            {t.enabled ? (
              <ConfirmDialog
                trigger={<Button variant="outline"><BanIcon data-icon="inline-start" />Disable</Button>}
                title={`Disable ${t.label}?`}
                description="New runs, tests, and config assignments are blocked. Active Hub runs and tests using this target are asked to cancel."
                confirmLabel="Disable target"
                onConfirm={() => setEnabled.mutate(false, { onSuccess: () => toast.success("Target disabled"), onError: (e) => toast.error(errorMessage(e)) })}
              />
            ) : (
              <Button variant="outline" onClick={() => setEnabled.mutate(true, { onSuccess: () => toast.success("Target enabled"), onError: (e) => toast.error(errorMessage(e)) })}>
                <CircleCheckIcon data-icon="inline-start" />Enable
              </Button>
            )}
            <ConfirmDialog
              trigger={<Button variant="destructive"><Trash2Icon data-icon="inline-start" />Delete</Button>}
              title={`Delete ${t.label}?`}
              description="Deletion is blocked while an importer config references this target."
              confirmLabel="Delete target"
              onConfirm={() => del.mutate(undefined, { onSuccess: () => { toast.success("Target deleted"); navigate(ux("/docker-targets")); }, onError: (e) => toast.error(errorMessage(e)) })}
            />
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Route profile</CardTitle><CardDescription>Immutable after creation — route changes require a new target ID.</CardDescription></CardHeader>
          <CardContent>
            <DescriptionList items={[
              { label: "Transport", value: String(t.profile.transport) },
              ...Object.entries(t.profile).filter(([k]) => k !== "transport").map(([k, v]) => ({ label: k, value: String(v) })),
              { label: "Created", value: formatDateTime(t.createdAt) },
              { label: "Updated", value: formatDateTime(t.updatedAt) },
            ]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Details</CardTitle><CardDescription>Label and description are the only editable fields.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="dt-edit-label">Label</FieldLabel>
              <Input id="dt-edit-label" value={label ?? t.label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="dt-edit-desc">Description</FieldLabel>
              <Textarea id="dt-edit-desc" rows={2} value={description ?? t.description ?? ""} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div>
              <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ label: (label ?? t.label).trim(), description: (description ?? t.description ?? "").trim() || null }, { onSuccess: () => { setLabel(null); setDescription(null); toast.success("Target updated"); }, onError: (e) => toast.error(errorMessage(e)) })}>Save details</Button>
            </div>
            {needsCredential && (
              <Field>
                <FieldLabel htmlFor="dt-test-config">Test with credential context</FieldLabel>
                <Select value={testConfig} onValueChange={setTestConfig}>
                  <SelectTrigger id="dt-test-config" className="w-full"><SelectValue placeholder={hubConfigs.length ? "Select a Hub Docker config" : "No Hub config references this target"} /></SelectTrigger>
                  <SelectContent>
                    {hubConfigs.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
