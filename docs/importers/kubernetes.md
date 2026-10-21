# Kubernetes importer

> **Status: scaffold.** This importer registers the Kubernetes provider and
> emits a placeholder component per configured resource type — it does
> **not** call a cluster API yet. Use it to exercise the importer-config →
> run → catalog flow; don't expect real inventory.

## What it creates today

- One component (`CONTAINER_ORCHESTRATION` category, provider `KUBERNETES`)
  per configured resource type, named `<resourceType>:<namespace>`, with a
  synthetic instance.

## Prerequisites in the cluster

**None today** — no cluster calls are made. When live discovery lands,
expect to need a ServiceAccount + RBAC read permissions and a kubeconfig or
in-cluster config.

## Credentials

None.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `namespace` | string | `default` | Namespace label recorded on the placeholder asset |
| `resourceTypes` | string[] | `["apps/v1:Deployment"]` | `apiVersion:Kind` labels; one placeholder component each |
| `endpoint` | URL | unset | Recorded on the asset's details/url; reserved for the API server address |
