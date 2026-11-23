# Research: Kubernetes Declared-Edge Carrier

Phase 0 output for spec `079-kubernetes-declared-edges`. The contract is ratified (ADR-133); this file records only carrier-4 mechanics — every inherited decision is normative from specs 076–078 and is not re-litigated here.

## D1 — Edge surfacing point: `PodImageBom`, not core

**Decision**: `PodImageBom` gains `edges?: { from: string; to: string }[]` — the union across the workload's resolved pod images of each document's `ImageBomResult.edges` with **target-position `SUBJECT` already resolved to `docker-image:{digestRef}`** and source-position `SUBJECT` left intact as the sentinel. Populated exactly when that workload's `entries` is present (the same set of resolved images contributes both).

**Rationale**: spec 078 already populated `ImageBomResult.edges` on the referrers path — the only discard site is `collectPodImageBoms`, which reads `result.entries` and drops `result.edges`. Each image's `digestRef` exists only inside that per-image loop; after the workload union is built there is no way to know which document an edge came from, so target-side substitution (which needs the digest) must happen there. Source-side substitution needs the carrier's externalId, which does *not* exist until `buildAsset` runs in `importer.ts` — hence the asymmetric split: `to === SUBJECT` resolved at collection, `from === SUBJECT` resolved at emission.

**Alternatives considered**: (a) carry `Map<digestRef, SpdxEdge[]>` per workload — rejected, preserves per-document separation the emission never needs and doubles the plumbing for zero contract gain; (b) resolve `to === SUBJECT` to the workload's externalId — rejected, that asserts "package depends on the workload," which is false: the document says "package depends on the image artifact," whose canonical catalog identity is `docker-image:{digestRef}` (carrier-3 rule); (c) drop `to === SUBJECT` edges early — rejected, identical observable result today (no `docker-image:*` asset is ever yielded in a kubernetes run, so same-run scope drops them at the pass) but keeps the data honest and future-proof if image components ever land.

## D2 — `SUBJECT` binding: one carrier kind — the workload

**Decision**: source-side `SUBJECT` expands to the workload `CONTAINER_ORCHESTRATION` asset that carries that image's `bomEntries`. A workload running several images substitutes the same externalId into each carried document's source-position `SUBJECT` — each image's `SUBJECT → package` edges land on that workload.

**Rationale**: kubernetes yields a single asset kind (one placeholder workload per configured `apiVersion:Kind`); there is no `includeImages`-style second carrier and no `docker-image:*` asset — the workload is the only catalog face bearing the image's content in this importer. This is the carrier-3 `SUBJECT` rule with its image-carrier arm absent, not a new rule.

**Alternatives considered**: (a) a synthetic `docker-image:{digest}` `PACKAGE_REGISTRY` yield to host target-side subject edges — rejected, out of scope: the kubernetes importer's contract is workload inventory, and inventing a second asset kind for a ~0-occurrence edge type is unjustified surface area; (b) subject edges on a per-pod rather than per-workload basis — rejected, pods aren't catalog assets; `bomEntries` already aggregate at workload scope, so edges aggregate identically.

## D3 — Config gating: `importDeclaredEdges → includePodImageSbom` refinement

**Decision**: `kubernetesConfigSchema` gains `importDeclaredEdges: z.boolean().default(false)` (verbatim UX-EDGE-03 describe copy) plus a refinement `!importDeclaredEdges || includePodImageSbom` (message on the `importDeclaredEdges` path, docker's wording pattern). The existing `endpoint || sourceKey` refine stays. No unrefined-base export is required — `importer-kubernetes` declares `secrets: []` and implements no `testSecrets`, so the `.partial()`-on-refined-schema limitation that forced docker's `dockerConfigBase` split does not apply.

**Rationale**: the pod-image SBOM fetch is the only edge source; `importDeclaredEdges: true` with `includePodImageSbom: false` is dead config that silently emits nothing — the dependent-toggle shape of carriers 1 (`includeDependencyGraph`) and 3 (`includeSbom`), not carrier 2's unconditional switch (whose document *is* the graph). `endpoint` is not additionally required: `includePodImageSbom` in `sourceKey` mode already degrades to `UNAVAILABLE` markers with `bomEntries` absent — a marker-only workload simply omits `relationships` under the field-presence doctrine, which is honest non-authoritative behavior, not invalid config.

**Alternatives considered**: (a) also require `endpoint` — rejected, invents a constraint `includePodImageSbom` itself does not carry; the degraded path already expresses "no cluster to query" faithfully; (b) unconditional switch — rejected (dead-config footgun, same as carrier 3); (c) base-schema split for consistency — rejected, the split exists only for `testSecrets`' `.partial()`; exporting an unused base is ceremony without a consumer.

## D4 — LIBRARY emission: collect during the workload loop, drain at run end

**Decision**: maintain run-level `libraryEntries`/`libraryEdges` maps; each opted-in workload whose `PodImageBom` resolved feeds `indexBomEntries(bom.entries)` identities and its `edges` (already target-resolved) into the maps; after the workload loop, drain once — `buildLibraryAsset(identity, entry, dependsOnRels(allEdges, identity))` per identity.

**Rationale**: identical to docker's post-review shape (T013): a `package → package` edge declared in any image's SBOM must land on the single `LIBRARY` yield even when that package was first seen under another image — collect-then-drain gives the run-wide union. Kubernetes has one carrier loop, so this degenerates cleanly: accumulate inside the `resourceTypes` loop, drain after it.

**Alternatives considered**: (a) inline yield per workload — rejected, reproduces the under-emission defect docker's code review caught: an edge declared only in a later image's SBOM for an already-yielded purl would drop; (b) per-image rather than per-workload dedup — irrelevant, the union is what the edge pass needs and duplicates collapse at `(from, to)` key insertion.

## D5 — e2e: `mock-kubernetes` fixture server + existing OCI registry scenario

**Decision**: new `playwright/mocks/kubernetes/server.ts` on the shared `startDataServer`/`startControlServer`/`log` helpers — **plain HTTP** (the importer's `apiGet` is a plain `fetch(endpoint + path)`; `endpoint` only has to be a URL). Routes: `GET /api/v1/namespaces/{ns}/pods` → a pod list where pod `web-abc` is owned by `ReplicaSet/web-abc` and runs container image `mock-docker-engine:5000/pw-web@sha256:<64-hex>` (digest form — no `imageID` lookup needed); `GET /apis/apps/v1/namespaces/{ns}/replicasets/web-abc` → RS owned by `Deployment/web`. A `pods-empty` scenario swaps in an empty pod list for the degraded path. New compose service (`Dockerfile.mocks`, `node mocks/kubernetes/server.ts`, `MOCK_PORT: 6443`, `MOCK_CONTROL_PORT: 9444`, healthcheck on the control port) + `mock-kubernetes` in `mock-control`'s `TARGETS`. The pod image digest points at the docker mock's existing registry listener, so `mock-docker-engine`'s `sbom`/`sbom-reduced` scenarios drive which SBOM the run sees — the journey sets/resets that scenario exactly like `docker-declared-edges.spec.ts` does.

**Rationale**: the only missing surface is the Kubernetes API — the SBOM fetch side is already fully mocked by spec 078's OCI companion listener (plain TLS, workload-CA-signed, which `app` already trusts via `NODE_EXTRA_CA_CERTS`). Reusing `pw-web`'s document gives the same graph docker's journey asserts on: `subject → pw-app/express/pw-hide-*`, `express → accepts` (library→library), and `pw-lib → root` — which under kubernetes resolves to `docker-image:{digest}` and must **drop**, giving a same-run-scope negative assertion no other carrier journey has.

**Alternatives considered**: (a) form-switch coverage only — rejected, the repo's e2e rule wants catalog-data-integrity coverage where feasible and the fixture cost is one small server; (b) a dedicated registry listener inside the k8s mock — rejected, duplicates the existing OCI listener for zero gain; (c) TLS on the k8s mock — rejected, `apiGet` presents no client cert and `endpoint` accepts `http://`; the stack's TLS story stays where it already exists (the registry).
