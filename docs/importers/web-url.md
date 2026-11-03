---
title: Web URL importer
description: What the Web URL importer discovers and how to configure it.
---

# Web URL importer

Imports a **collection of web endpoints** as Component profiles. One
ImporterConfig can declare many Components, each with per-environment
ComponentInstances — and one managed URL Check per instance.

## What it creates

- One Component per declared profile (`WEB_ENDPOINT` category, provider
  `WEB_URL`), named as configured — never after a URL.
- One ComponentInstance per declared instance, in the configured
  environment. On each run the importer performs one HTTP `GET` per
  instance; the response seeds the initial instance status (`RUNNING`
  when the endpoint responds 2xx, otherwise `ERROR`).
- One managed URL Check per instance, materialized on the first run —
  then the check's scheduled probes drive the monitored instance's status
  (`SUCCESS` → `RUNNING`, `FAILURE` → `ERROR`; missed/disabled preserve
  the last status).

## Prerequisites in the external tool

- Every configured URL must be reachable over **HTTP(S)** from the
  Componode backend (or the bound Import Agent).
- Pages are fetched **unauthenticated** — web-endpoint checks carry no
  authentication. Use the API URL importer for authenticated probes.
- URLs pointing at `localhost`, private/loopback/link-local IPs, cloud
  metadata addresses, or non-HTTP(S) schemes are rejected by the SSRF
  guard — this applies to instance URLs **and** check URL overrides.

## Credentials

None.

## Configuration

<!-- GENERATED:contract -->
**Secrets:** none
**Execution:** hub or Import Agent
**Source identity:** `context.reportSourceIdentity()`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `sourceKey` | string | yes | — | — |
| `components` | object[] | yes | — | — |
<!-- /GENERATED:contract -->


## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "URL is not allowed" | URL is private/loopback/metadata or non-HTTP(S) — the SSRF guard is working |
| Instance `ERROR` status | Page responded non-2xx — recorded as-is so the catalog reflects reachability |
| Check shows a definition conflict | Another Source owns a check with the same `checkKey` but different settings — reconcile the definitions |

## Monitoring vs. discovery

Each instance's managed check runs on the monitoring setup's cadence —
independently of import-run scheduling. The importer's own per-run fetch
only seeds the status until the check's first observation; after that,
check outcomes are authoritative. See [URL Checks](../url-checks.md).

## Source identity

Identity is `collection:<sourceKey>` — a generated UUID v7 in the config,
stable across edits and independent of profile names or URL sets. On
create you can reattach an unmonitored collection Source to keep its
Components, checks, and observation history.

## Upgrading from the single-URL config (v1 → v2)

The Web URL importer's v1 config took one `url` field. Upgrading the app
migrates each legacy config in place: it becomes a collection with one
profile whose instance key preserves the original Source identity, so the
imported Component keeps its history.

- **Existing instance** — the migrated scope keeps the matched
  ComponentInstance's `environment`, `region`, and `version`.
- **Existing URL Check** — when the instance already had exactly one URL
  Check on the same URL, the migration adopts it: same row, same
  observation history, now managed by the config. The check's previous
  `enabled` state carries over.
- **Legacy manual checks** — URL Checks that aren't owned by an importer
  config are disabled (they stop scheduling) and remain visible read-only.
  They keep their full observation history.
- **Source reattach** — if a config was deleted, creating a new collection
  config can reattach the orphaned Source from the "Collection identity"
  picker so its Components, checks, and history stay linked.
