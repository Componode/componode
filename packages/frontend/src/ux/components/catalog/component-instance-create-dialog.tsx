import * as React from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { ENVIRONMENTS, type CreateInstanceBlock } from "@componode/core";
import { describeApiError, type ApiError } from "@/api/client";
import { useCreateComponentInstance } from "@/api/hooks/components";
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
import { ENVIRONMENT_META } from "@/ux/lib/domain";
import type { Component } from "@/ux/lib/view-types";

/** Spec 054: focused first-instance recovery for a zero-instance Component. */
export function ComponentInstanceCreateDialog({
  component,
  trigger,
}: {
  component: Pick<Component, "id" | "name">;
  trigger?: React.ReactNode;
}) {
  const create = useCreateComponentInstance(component.id);
  const [open, setOpen] = React.useState(false);
  const [environment, setEnvironment] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [version, setVersion] = React.useState("");
  const [region, setRegion] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEnvironment("");
    setUrl("");
    setVersion("");
    setRegion("");
    setError(null);
  }, [open]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!environment) return setError("Environment is required.");
    const body: CreateInstanceBlock = {
      environment: environment as CreateInstanceBlock["environment"],
      ...(url.trim() ? { url: url.trim() } : {}),
      ...(version.trim() ? { version: version.trim() } : {}),
      ...(region.trim() ? { region: region.trim() } : {}),
    };
    create.mutate(body, {
      onSuccess: () => {
        toast.success(`First instance added to ${component.name}`);
        setOpen(false);
      },
      onError: (err) => setError(describeApiError(err as unknown as ApiError)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <PlusIcon data-icon="inline-start" />
            Add first instance
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add first instance</DialogTitle>
          <DialogDescription>
            Save one environment on {component.name}, then add URL checks to
            that instance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ci-environment">Environment</FieldLabel>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger id="ci-environment" className="w-full">
                  <SelectValue placeholder="Select an environment" />
                </SelectTrigger>
                <SelectContent>
                  {ENVIRONMENTS.map((env) => (
                    <SelectItem key={env} value={env}>
                      {ENVIRONMENT_META[env].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="ci-url">URL</FieldLabel>
              <Input
                id="ci-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://… (optional)"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="ci-version">Version</FieldLabel>
                <Input
                  id="ci-version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="Optional"
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ci-region">Region</FieldLabel>
                <Input
                  id="ci-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="Optional"
                  autoComplete="off"
                />
              </Field>
            </div>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Save instance
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
