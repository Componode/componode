---
title: Kubernetes importer
description: "Scaffold importer for Kubernetes: what it will discover and how to configure it."
---

# Kubernetes importer

> **Status: scaffold.** This importer registers the Kubernetes provider and
> emits a placeholder component per configured resource type — general
> workload discovery does **not** call the cluster API yet. The one live
> path is `includePodImageSbom`, which lists pods to attach image SBOMs.
> Use the importer to exercise the importer-config → run → catalog flow;
> don't expect real inventory beyond pod image BOMs.

## What it creates today

- One component (`CONTAINER_ORCHESTRATION` category, provider `KUBERNETES`)
  per configured resource type, named `<resourceType>:<namespace>`, with a
  synthetic instance.
- With `includePodImageSbom` on (and `endpoint` set): each workload
  component's **bill of materials** — the importer lists pods in the
  namespace, resolves ReplicaSet → Deployment owner chains, reads each
  pod image's pullable digest from `status.containerStatuses[].imageID`,
  and fetches that image's CycloneDX/SPDX attestation via the registry's
  OCI referrers API. Packages land as BOM entries (evidence
  `IMAGE_LAYER`/`SBOM_DOCUMENT`, `evidenceDetail` naming the pod-spec
  image reference) on the owning workload component. Images without an
  attestation report no inventory; a pod the referrers lookup can't
  resolve degrades `capabilities.bomInventory` rather than failing the
  run. `sourceKey`-only configs can't use the toggle — there is no
  cluster to query — and save validation rejects the combination.

## Prerequisites in the cluster

**For the placeholder flow:** none — no cluster calls are made.

**For `includePodImageSbom`:** the configured `endpoint` must be a
reachable API server and the importer needs read access to pods and
replicasets in the namespace (anonymous in-cluster or kubeconfig auth as
configured), plus anonymous pull access to the images' registries for
referrers. When live discovery lands, expect to need a ServiceAccount +
RBAC read permissions.

## Credentials

None.

## Configuration

<!-- GENERATED:contract -->
**Secrets:** none
**Execution:** hub or Import Agent
**Source identity:** `context.reportSourceIdentity()`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `namespace` | string | no | `default` | Namespace label recorded on the placeholder asset |
| `resourceTypes` | string[] | no | `["apps/v1:Deployment"]` | `apiVersion:Kind` labels; one placeholder component each |
| `endpoint` | URL | no | — | Recorded on the asset's details/url; reserved for the API server address |
| `sourceKey` | string | no | — | Fallback source identity when `endpoint` is absent — one of the two is required (ADR-120) |
| `includePodImageSbom` | bool | no | `false` | Read the SBOM of each container image running in pods and attach it to the workload's bill of materials. Requires `endpoint` plus anonymous pull access to the images' registries |
<!-- /GENERATED:contract -->


## Source identity

Identity is the canonicalized `endpoint` URL when set (scheme-normalized,
credentials and auth params stripped — never stored), else `scope.sourceKey`;
one of the two is **required** or the run fails. `externalId`s are qualified
(`{identity}::{namespace}:{type}`). Migration 023 backfills a Source +
memberships for configs that have an `endpoint`; endpoint-less configs adopt
on their next run once `sourceKey` is set.
