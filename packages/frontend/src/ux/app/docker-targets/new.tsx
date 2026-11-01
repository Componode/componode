import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCreateDockerTarget } from "@/api/hooks/docker-targets";
import { describeApiError, fieldErrors, type ApiError } from "@/api/client";
import { DockerTargetForm, dockerFormErrors, dockerProfileFrom, emptyDockerTargetForm } from "@/ux/components/admin/docker-target-form";
import { FormPage, FormSection } from "@/ux/components/forms/form-shell";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert";
import { ShieldCheckIcon } from "lucide-react";
import { ux } from "@/ux/lib/paths";

export function UxDockerTargetNewPage() {
  const navigate = useNavigate();
  const create = useCreateDockerTarget();
  const [value, setValue] = React.useState(emptyDockerTargetForm());
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs = dockerFormErrors(value);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const profile = dockerProfileFrom(value);
    if (!profile) { setErrors({ "profile.path": "Profile is incomplete." }); return; }
    create.mutate(
      {
        targetId: value.targetId.trim(),
        label: value.label.trim(),
        ...(value.description.trim() ? { description: value.description.trim() } : {}),
        profile,
      },
      {
        onSuccess: (r) => { toast.success(`${r.target.label} created`); navigate(ux(`/docker-targets/${r.target.id}`)); },
        onError: (err) => {
          const fe = fieldErrors(err as unknown as ApiError);
          if (Object.keys(fe).length) setErrors(fe);
          toast.error(describeApiError(err as unknown as ApiError));
        },
      },
    );
  }

  return (
    <PageContainer width="narrow">
      <PageHeader title="New Docker target" description="A non-secret access route the Hub uses to reach a Docker Engine." />
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>No secret values</AlertTitle>
        <AlertDescription>Profiles reference credential key names only. Certificate, key, and passphrase values stay in stored credentials.</AlertDescription>
      </Alert>
      <FormPage onSubmit={onSubmit} cancelHref={ux("/docker-targets")} submitLabel="Create target" pending={create.isPending}>
        <FormSection title="Target">
          <DockerTargetForm value={value} onChange={setValue} errors={errors} />
        </FormSection>
      </FormPage>
    </PageContainer>
  );
}
