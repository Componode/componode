# AWS importer

> **Status: scaffold.** This importer registers the AWS provider and emits a
> placeholder component per configured resource type — it does **not** call
> AWS APIs yet. Use it to exercise the importer-config → run → catalog flow;
> don't expect real inventory.

## What it creates today

- One component (`COMPUTE` category, provider `AWS`) per configured resource
  type, named `<resourceType>:<region>`, with a synthetic instance.

## Prerequisites in AWS

**None today** — no AWS calls are made. When live discovery lands, expect to
need an IAM role/user with read-only inventory permissions and static
credentials or an assumable role.

## Credentials

None.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `region` | string | `us-east-1` | Region label recorded on the placeholder asset |
| `resourceTypes` | string[] | `["ec2:instance"]` | Resource type labels; one placeholder component each |
| `endpoint` | URL | unset | Recorded on the asset's details/url; reserved for a future real connection |
