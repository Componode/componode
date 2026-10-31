# MCP Server importer

> **Status: scaffold.** This importer registers the MCP Server provider and
> emits a placeholder component per configured resource type — it does
> **not** connect to an MCP server yet. Use it to exercise the
> importer-config → run → catalog flow; don't expect real inventory.

## What it creates today

- One component (`MCP_SERVER` category, provider `MCP_SERVER`) per
  configured resource type, named `mcp:<resourceType>`, with a synthetic
  instance.

## Prerequisites in the MCP server

**None today** — no MCP connection is made. When live discovery lands,
expect to need the server's transport address plus whatever auth the server
requires (bearer token / OAuth client).

## Credentials

None.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `resourceTypes` | string[] | `["tools/list"]` | MCP method labels; one placeholder component each |
| `endpoint` | URL | unset | Recorded on the asset's details/url; reserved for the server's transport URL |

## Source identity

Identity is the canonicalized `endpoint` URL when set (scheme-normalized,
credentials and auth params stripped — never stored), else `scope.sourceKey`;
one of the two is **required** or the run fails. `externalId`s are qualified
(`{identity}::{method}` — previously `{endpoint}:{method}` or `mcp:{method}`).
Migration 023 backfills a Source + memberships for configs that have an
`endpoint`; endpoint-less configs adopt on their next run once `sourceKey` is
set.
