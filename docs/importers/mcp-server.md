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
