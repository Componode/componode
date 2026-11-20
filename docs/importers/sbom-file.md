---
title: SBOM File importer
description: What the SBOM File importer ingests and how to configure it.
---

# SBOM File importer

Ingests **one SBOM document** — CycloneDX JSON or SPDX JSON — fetched from
an HTTPS URL and attaches its package inventory to an **existing** catalog
component's bill of materials. Use it to feed SBOMs produced by build
pipelines (Syft, Trivy, cdxgen, SPDX tools) into Componode without wiring a
native importer.

## What it creates

- **Nothing new** — the importer never creates components or instances.
  The document's packages land as BOM entries on the component named by
  `componentSlug` (or replace that component's previous entries from this
  source).
- Each package becomes a factual BOM entry — purl, name, version,
  ecosystem, scope/directness, licenses, and evidence `SBOM_DOCUMENT`.
  CycloneDX `components` nesting and SPDX `CONTAINS` relationships are
  preserved as parent/child entries.
- Packages without a `purl` are skipped and counted; the run reports a
  capability note (`N package(s) without a purl were skipped`) rather
  than failing.

## Prerequisites in the external tool

- The SBOM URL must be reachable over **HTTPS** from the Componode backend
  (or the bound Import Agent). Redirects are followed at most 3 hops, and
  every hop is re-validated — a redirect to a private host or plain HTTP
  is rejected.
- The document must be **JSON** and either CycloneDX (`bomFormat:
  "CycloneDX"`) or SPDX (`spdxVersion: "SPDX-…"`). Format is detected
  automatically; XML and other serializations are not supported.
- Documents are capped at **25 MB**.
- The target component must already exist in the catalog — typically
  imported by another importer (GitHub, Docker, …). Take its slug from the
  component page URL.

## Credentials

None — the document is fetched unauthenticated.

## Configuration

<!-- GENERATED:contract -->
**Secrets:** none
**Execution:** hub or Import Agent
**Source identity:** `context.reportSourceIdentity()`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `sbomUrl` | URL | yes | — | HTTPS URL of a CycloneDX JSON or SPDX JSON document to ingest |
| `componentSlug` | string | yes | — | Slug of the catalog component this SBOM describes. The document is attached to that component — if it no longer exists at run time the import fails; it never creates a component. |
| `resolvedComponent` | object | no | — | — |
<!-- /GENERATED:contract -->

### `componentSlug` resolution

`componentSlug` is resolved to the component's dedup identity **at run
dispatch**, not at save time: saving a config validates the slug exists,
and each run re-resolves it. If the component is deleted or renamed after
the config was saved, the run fails with a targeting error — the importer
never guesses an identity and never creates the component.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "URL is not allowed" / "HTTPS is required" | URL is private/loopback/metadata or not HTTPS — the SSRF guard is working |
| "unrecognized SBOM format" | Document is neither CycloneDX JSON nor SPDX JSON (XML, CSV, and HTML error pages all land here) |
| "document exceeds the 25 MB size limit" | SBOM too large — point at a compressed/smaller artifact |
| "too many redirects" | More than 3 redirect hops — configure the final URL |
| BOM shows "unavailable"/"forbidden" capability | Fetch returned 404 / 401 / 403 — the component keeps its last good inventory and the marker explains the degradation |
| "componentSlug could not be resolved" | The target component no longer exists — update the config with a current slug |
| Packages missing from the BOM | They had no `purl` — check the capability note's skipped count |

## Failure semantics

A failed fetch or parse does **not** fail the run and does **not** wipe
the component's existing BOM entries from this source — the importer
yields the component with a degraded `bomInventory` capability marker
(`UNAVAILABLE`, `FORBIDDEN`, or `ERROR`) and no `bomEntries`, so the last
successfully imported inventory persists and goes stale on the normal
freshness clock. A successful run with an empty package list legitimately
replaces the source's prior set with zero entries (ADR-057 Amendment 1).

## Source identity

Identity is `sbom-file:<sbomUrl>` — the document URL is the stable source
identity, so editing `componentSlug` keeps history while pointing the same
URL at a new component.
