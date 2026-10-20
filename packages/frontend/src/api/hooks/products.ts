import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type {
  ProductListResponse,
  ProductDetail,
  DigitalProduct,
  Link,
  BootstrapReport,
} from "@/api/types";

export interface ProductListParams {
  q?: string;
  type?: string;
  lifecycle?: string;
  tag?: string;
  criticality?: string;
  /** Spec 023: completeness-gap facet — CSV of owner/dependencies/description. */
  missing?: string;
  includeRetired?: boolean;
}

export function useProducts(params: ProductListParams = {}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.type) search.set("type", params.type);
  if (params.lifecycle) search.set("lifecycle", params.lifecycle);
  if (params.tag) search.set("tag", params.tag);
  if (params.criticality) search.set("criticality", params.criticality);
  if (params.missing) search.set("missing", params.missing);
  if (params.includeRetired) search.set("includeRetired", "true");
  const qs = search.toString();
  return useQuery({
    queryKey: ["products", qs],
    queryFn: () => api<ProductListResponse>(`/products${qs ? `?${qs}` : ""}`),
    placeholderData: (prev) => prev, // preserve data during refetch (docs/ux.md §6)
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ["products", "detail", slug],
    queryFn: () => api<ProductDetail>(`/products/${slug}`),
    enabled: !!slug,
  });
}

function invalidateProducts(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["products"] });
}

export interface ProductFormInput {
  name?: string;
  slug?: string;
  type?: string;
  description?: string | null;
  lifecycle?: string;
  lobOwnerId?: string | null;
  teamOwnerId?: string | null;
  links?: Link[];
  tags?: string[];
  criticality?: string | null;
  sunsetAt?: string | null;
  /** Spec 021 US2 fast path — wire these components on create, atomically. */
  componentIds?: string[];
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: ProductFormInput) =>
      api<{ product: DigitalProduct }>("/products", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & ProductFormInput) =>
      api<{ product: DigitalProduct }>(`/products/${vars.id}`, {
        method: "PATCH",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`/products/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateProducts(qc),
  });
}

/**
 * ADR-114 catalog bootstrap import. `document` is the raw file text — sent as
 * `application/yaml` for both YAML and JSON documents (the backend parses
 * either). `dryRun` previews the report without writes.
 */
export function useBootstrapProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { document: string; dryRun: boolean }) =>
      api<BootstrapReport>(
        `/products/bootstrap${vars.dryRun ? "?dryRun=true" : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/yaml" },
          body: vars.document,
        },
      ),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) {
        invalidateProducts(qc);
        qc.invalidateQueries({ queryKey: ["components"] });
        qc.invalidateQueries({ queryKey: ["component-groups"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });
}

export type EdgeKind = "composes" | "consumes-from" | "depends-on";

export function useAddEdge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; kind: EdgeKind; body: Record<string, string | string[]> }) =>
      api<undefined>(`/products/${vars.id}/${vars.kind}`, {
        method: "POST",
        body: JSON.stringify(vars.body),
      }),
    onSuccess: () => {
      invalidateProducts(qc);
      qc.invalidateQueries({ queryKey: ["components"] });
      qc.invalidateQueries({ queryKey: ["component-groups"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRemoveEdge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      kind: EdgeKind;
      otherId: string;
      /** depends-on targets are kind-discriminated (ADR-110 §4). */
      targetKind?: "component" | "group";
    }) =>
      api<undefined>(
        `/products/${vars.id}/${vars.kind}/${vars.otherId}${vars.targetKind ? `?kind=${vars.targetKind}` : ""}`,
        { method: "DELETE" },
      ),
    onSuccess: () => invalidateProducts(qc),
  });
}
