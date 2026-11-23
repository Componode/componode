import Docker from "dockerode";
import {
  buildLibraryAsset,
  canonicalizeSourceIdentity,
  dependsOnRels,
  indexBomEntries,
  SPDX_EDGE_SUBJECT,
  validateDiscoveredAsset,
  type CredentialTestResult,
  type DiscoveredAsset,
  type DiscoveredAssetInstance,
  type ImageBomResult,
  type DiscoveredBomEntry,
  type Importer,
  type ImporterContext,
  type SpdxEdge,
} from "@componode/core";
import { maskSecretValues } from "@componode/core/secrets";
import { dockerConfigBase, dockerConfigSchema } from "./config.js";
import { validateTargetProfile } from "./target-profile.js";
import { buildDockerOptions } from "./transport.js";
import {
  mapContainer,
  buildAsset,
  mapImageInspectDetails,
  type ContainerInspect,
  type ImageInspect,
} from "./mapping.js";
import {
  mapSwarmNode,
  mapSwarmSecret,
  mapSwarmService,
  type SwarmNode,
  type SwarmSecret,
  type SwarmService,
} from "./swarm.js";
import { type WorkloadIdentity } from "./identity.js";
import { fetchImageBom, parseRepoDigest } from "./docker-sbom.js";
import { mapEngineAsset, type EngineInfo, type EngineVersion } from "./engine.js";
import {
  mapNetwork,
  mapVolume,
  type NetworkInspect,
  type VolumeSummary,
  type VolumeUsageData,
} from "./infra.js";

const INSPECT_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (signal.aborted) throw new Error("aborted");
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export class DockerImporter implements Importer {
  readonly name = "docker";
  readonly version = "1.1.0";

  async *run(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
    context: ImporterContext,
  ): AsyncGenerator<DiscoveredAsset> {
    if (context.signal.aborted) return;
    const parsed = dockerConfigSchema.parse(config);

    context.reportPhase("Resolving target");
    const profile = validateTargetProfile(
      context.resolveTarget(parsed.targetId),
    );
    const docker = new Docker(buildDockerOptions(profile, secrets));

    context.reportPhase("Identifying source");
    const info = (await docker.info()) as EngineInfo;
    const engineId = info?.ID;
    if (!engineId && !parsed.sourceKey) {
      throw new Error(
        "Docker Engine /info.ID is unavailable and no sourceKey is configured — cannot attribute the run to an ImporterSource",
      );
    }
    // Canonicalize once and reuse — standalone/instance externalIds embed
    // this prefix and must match the canonical form the Source service
    // stores (code-review T041).
    const sourceIdentity = canonicalizeSourceIdentity(
      `docker-engine:${engineId ?? parsed.sourceKey}`,
    );
    await context.reportSourceIdentity({
      externalIdentity: sourceIdentity,
      label: info?.Name ?? parsed.sourceKey,
    });

    // Engine component (spec 064): one COMPUTE asset per source, emitted
    // before inventory — the engine is the root of the run's facts.
    // /version is fetched once per run here and shared with the Swarm
    // API-floor gate below (non-Swarm engines gain this single call).
    context.reportPhase("Reading engine facts");
    const version = (await docker.version()) as EngineVersion;
    const engineAsset = mapEngineAsset(info, version, sourceIdentity);
    if (!validateDiscoveredAsset(engineAsset)) {
      throw new Error("Invalid discovered asset for docker engine");
    }
    yield engineAsset;

    // Swarm inventory gate (ADR-121 Amendment 2): gated entirely on the
    // already-fetched /info — non-Swarm and worker-only endpoints make
    // zero additional calls. Below the 1.41 floor the run fails visibly;
    // a partial Swarm inventory is never emitted.
    const swarm = info?.Swarm;
    if (swarm?.LocalNodeState === "active" && swarm?.ControlAvailable === true) {
      context.reportPhase("Inventorying Swarm");
      const [apiMajor = 0, apiMinor = 0] = (version?.ApiVersion ?? "0.0")
        .split(".")
        .map(Number);
      // Fail closed on a malformed version string — NaN comparisons
      // are false, which would silently skip the floor.
      if (
        !Number.isFinite(apiMajor) ||
        !Number.isFinite(apiMinor) ||
        apiMajor * 100 + apiMinor < 141
      ) {
        throw new Error(
          `Swarm inventory requires Docker Engine API >= 1.41 (got ${version?.ApiVersion ?? "unknown"})`,
        );
      }
      if (context.signal.aborted) return;
      const [services, nodes, swarmSecrets] = (await Promise.all([
        docker.listServices({ status: true }),
        docker.listNodes(),
        docker.listSecrets(),
      ])) as [SwarmService[], SwarmNode[], SwarmSecret[]];
      for (const svc of services) {
        if (context.signal.aborted) return;
        const asset = mapSwarmService(
          svc,
          sourceIdentity,
          parsed.environmentLabel,
          parsed.environmentMap,
        );
        if (!validateDiscoveredAsset(asset)) {
          throw new Error(`Invalid discovered asset for swarm service ${svc.Spec?.Name ?? svc.ID}`);
        }
        yield asset;
      }
      for (const node of nodes) {
        if (context.signal.aborted) return;
        const asset = mapSwarmNode(node, sourceIdentity);
        if (!validateDiscoveredAsset(asset)) {
          throw new Error(`Invalid discovered asset for swarm node ${node.Spec?.Name ?? node.ID}`);
        }
        yield asset;
      }
      for (const secret of swarmSecrets) {
        if (context.signal.aborted) return;
        const asset = mapSwarmSecret(secret, sourceIdentity);
        if (!validateDiscoveredAsset(asset)) {
          throw new Error(`Invalid discovered asset for swarm secret ${secret.Spec?.Name ?? secret.ID}`);
        }
        yield asset;
      }
    }

    if (context.signal.aborted) return;
    context.reportPhase("Listing containers");
    const containers = await docker.listContainers({ all: true });

    if (context.signal.aborted) return;
    context.reportPhase("Inspecting containers");
    const inspects = await mapWithConcurrency(
      containers,
      INSPECT_CONCURRENCY,
      (c) =>
        docker.getContainer(c.Id).inspect() as Promise<ContainerInspect>,
      context.signal,
    );

    const groups = new Map<
      string,
      { identity: WorkloadIdentity; instances: DiscoveredAssetInstance[]; imageRef: string }
    >();
    for (const inspect of inspects) {
      const mapped = mapContainer(
        inspect,
        sourceIdentity,
        parsed.environmentLabel,
        parsed.environmentMap,
        parsed.componentIdLabel,
      );
      const group = groups.get(mapped.identity.externalId) ?? {
        identity: mapped.identity,
        instances: [],
        imageRef: inspect.Config?.Image ?? "",
      };
      group.instances.push(mapped.instance);
      groups.set(mapped.identity.externalId, group);
    }

    // Spec 073: per-digest SBOM cache — several workloads can run the same
    // image; each registry is asked once.
    const bomByDigest = new Map<
      string,
      Awaited<ReturnType<typeof fetchImageBom>>
    >();
    const bomForRef = async (imageRef: string) => {
      let digestRef: string | null = null;
      try {
        const insp = (await docker.getImage(imageRef).inspect()) as {
          RepoDigests?: string[] | null;
        };
        digestRef = insp?.RepoDigests?.find((d) => parseRepoDigest(d)) ?? null;
      } catch {
        digestRef = null;
      }
      if (!digestRef) {
        return {
          bom: {
            marker: {
              status: "UNAVAILABLE" as const,
              message: "image has no registry digest — built locally or not pulled from a registry",
            },
          } satisfies ImageBomResult,
          digestRef: null,
        };
      }
      const cached = bomByDigest.get(digestRef);
      if (cached) return { bom: cached, digestRef };
      const result = await fetchImageBom(digestRef);
      bomByDigest.set(digestRef, result);
      return { bom: result, digestRef };
    };

    // Spec 078 / ADR-133 — declared-edge carrier 3. A document's SUBJECT
    // in target position resolves to the canonical `docker-image:{digest}`
    // identity — it materializes only when the image asset is in the same
    // run. In source position each SBOM-bearing carrier (workloads + the
    // docker-image component) substitutes its own externalId.
    const resolveSubjectTargets = (bom: ImageBomResult, digestRef: string) =>
      (bom.edges ?? []).map((e) => ({
        from: e.from,
        to: e.to === SPDX_EDGE_SUBJECT ? `docker-image:${digestRef}` : e.to,
      }));
    const declaredEdgesFor = (
      bom: ImageBomResult,
      carrierExternalId: string,
      digestRef: string,
    ) =>
      dependsOnRels(
        resolveSubjectTargets(bom, digestRef).map((e) => ({
          from: e.from === SPDX_EDGE_SUBJECT ? carrierExternalId : e.from,
          to: e.to,
        })),
        carrierExternalId,
      );
    // One LIBRARY asset per purl identity per run, drained after every
    // bom-bearing carrier has emitted so the single yield carries the
    // run-wide union of package→package edges — an edge declared in any
    // image's SBOM lands on the shared package's asset (code-review T013).
    const libraryEntries = new Map<string, DiscoveredBomEntry>();
    const libraryEdges = new Map<string, SpdxEdge>();
    const collectLibraryBom = (bom: ImageBomResult, digestRef: string) => {
      if (!parsed.importDeclaredEdges || !bom.entries) return;
      for (const [identity, entry] of indexBomEntries(bom.entries)) {
        if (!libraryEntries.has(identity)) libraryEntries.set(identity, entry);
      }
      for (const e of resolveSubjectTargets(bom, digestRef)) {
        if (!libraryEdges.has(`${e.from} ${e.to}`)) {
          libraryEdges.set(`${e.from} ${e.to}`, e);
        }
      }
    };

    context.reportPhase("Emitting assets");
    for (const group of groups.values()) {
      if (context.signal.aborted) return;
      const asset = buildAsset(group.identity, group.instances, group.imageRef);
      let groupBom: ImageBomResult | undefined;
      let groupDigest: string | null = null;
      if (parsed.includeSbom && group.imageRef) {
        ({ bom: groupBom, digestRef: groupDigest } = await bomForRef(
          group.imageRef,
        ));
        if (groupBom.entries) {
          asset.bomEntries = groupBom.entries;
          // `relationships` present (possibly []) exactly when bomEntries
          // is — field-presence is the edge pass's authority signal.
          if (parsed.importDeclaredEdges && groupDigest) {
            asset.relationships = declaredEdgesFor(groupBom, asset.externalId, groupDigest);
          }
        }
        (asset.details as Record<string, unknown>).capabilities = {
          ...((asset.details as Record<string, unknown>).capabilities as object ?? {}),
          bomInventory: groupBom.marker,
        };
      }
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for workload ${group.identity.externalId}`);
      }
      yield asset;
      if (groupBom && groupDigest) collectLibraryBom(groupBom, groupDigest);
    }

    if (parsed.includeImages) {
      if (context.signal.aborted) return;
      context.reportPhase("Listing images");
      const images = await docker.listImages();

      // Resolve every emitted ref first, then inspect each unique image
      // Id once (spec 064) — a failed inspect degrades that image only:
      // the asset still emits with its pre-feature details.
      const emitted: Array<{
        image: (typeof images)[number];
        externalId: string;
        name: string;
      }> = [];
      const seen = new Set<string>();
      for (const image of images) {
        // External IDs carry the raw ref — `docker-image:{repo@sha256:…}`
        // for digests, `docker-image:{repo:tag}` for tags (ADR-121 #6).
        const refs = image.RepoDigests?.length
          ? image.RepoDigests.filter((d) => d !== "<none>@<none>")
          : (image.RepoTags ?? []).filter((t) => t !== "<none>:<none>");
        for (const ref of refs) {
          const externalId = `docker-image:${ref}`;
          if (seen.has(externalId)) continue;
          seen.add(externalId);
          emitted.push({ image, externalId, name: ref });
        }
      }

      const uniqueIds = [
        ...new Set(
          emitted
            .map((e) => e.image.Id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const inspectDetails = new Map<string, Record<string, unknown>>();
      await mapWithConcurrency(
        uniqueIds,
        INSPECT_CONCURRENCY,
        async (id) => {
          try {
            const insp = (await docker.getImage(id).inspect()) as ImageInspect;
            inspectDetails.set(id, mapImageInspectDetails(insp));
          } catch {
            // Per-image degradation (ratified): no merge for this image.
          }
        },
        context.signal,
      );

      context.reportPhase("Emitting images");
      for (const { image, externalId, name } of emitted) {
        if (context.signal.aborted) return;
        const asset: DiscoveredAsset = {
          category: "PACKAGE_REGISTRY",
          provider: "DOCKER",
          resourceType: "image",
          name,
          externalId,
          details: {
            imageId: image.Id,
            size: image.Size,
            created: image.Created,
            ...(image.Id ? inspectDetails.get(image.Id) : undefined),
          },
          instances: [],
        };
        // Digest-form refs (repo@sha256:…) resolve SBOM attestations
        // directly — tag-form refs resolve through the workload path.
        let imageBom: ImageBomResult | undefined;
        let imageDigest: string | null = null;
        if (parsed.includeSbom) {
          const refPart = externalId.slice("docker-image:".length);
          if (parseRepoDigest(refPart)) {
            const bom =
              bomByDigest.get(refPart) ??
              (await fetchImageBom(refPart));
            bomByDigest.set(refPart, bom);
            imageBom = bom;
            imageDigest = refPart;
            if (bom.entries) {
              asset.bomEntries = bom.entries;
              if (parsed.importDeclaredEdges) {
                asset.relationships = declaredEdgesFor(bom, externalId, refPart);
              }
            }
            (asset.details as Record<string, unknown>).capabilities = {
              ...((asset.details as Record<string, unknown>).capabilities as object ?? {}),
              bomInventory: bom.marker,
            };
          }
        }
        if (!validateDiscoveredAsset(asset)) {
          throw new Error(`Invalid discovered asset for image ${externalId}`);
        }
        yield asset;
        if (imageBom && imageDigest) collectLibraryBom(imageBom, imageDigest);
      }
    }

    // Libraries drain here — after every SBOM-bearing carrier — so each
    // per-identity yield carries the run-wide edge union (T013).
    for (const [identity, entry] of libraryEntries) {
      if (context.signal.aborted) return;
      const lib = buildLibraryAsset(
        identity,
        entry,
        dependsOnRels([...libraryEdges.values()], identity),
      );
      if (!validateDiscoveredAsset(lib)) {
        throw new Error(`Invalid discovered asset for library ${identity}`);
      }
      yield lib;
    }

    // Infrastructure inventory (spec 065): NETWORK components from
    // /networks + per-network inspect (the list omits Containers on
    // API >= 1.28) and STORAGE components from /volumes joined to
    // /system/df usage by Name. All three fetches complete before any
    // yield — fail-closed: any list/inspect/df error fails the run and
    // partial infra inventory is never emitted (FR-012).
    if (context.signal.aborted) return;
    context.reportPhase("Inventorying infrastructure");
    const [networks, volumesResp, dfResp] = await Promise.all([
      docker.listNetworks() as Promise<
        NetworkInspect[] | { Networks?: NetworkInspect[] }
      >,
      docker.listVolumes() as Promise<{ Volumes?: VolumeSummary[] }>,
      docker.df() as Promise<{
        Volumes?: (VolumeSummary & { UsageData?: VolumeUsageData })[];
      }>,
    ]);
    const networkList = Array.isArray(networks)
      ? networks
      : (networks.Networks ?? []);
    const volumeList = volumesResp.Volumes ?? [];
    const usageByName = new Map(
      (dfResp.Volumes ?? []).map((v) => [v.Name, v.UsageData]),
    );

    const networkInspects = await mapWithConcurrency(
      networkList,
      INSPECT_CONCURRENCY,
      (n) => {
        const key = n?.Id ?? n?.Name;
        if (!key) {
          throw new Error("network list row missing both Id and Name");
        }
        return docker.getNetwork(key).inspect() as Promise<NetworkInspect>;
      },
      context.signal,
    );
    for (const net of networkInspects) {
      if (context.signal.aborted) return;
      const asset = mapNetwork(net, sourceIdentity);
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for network ${net.Name ?? net.Id}`);
      }
      yield asset;
    }
    for (const vol of volumeList) {
      if (context.signal.aborted) return;
      const asset = mapVolume(vol, usageByName.get(vol.Name), sourceIdentity);
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for volume ${vol.Name}`);
      }
      yield asset;
    }

    context.reportPhase("Completed");
  }

  // Minimal per-transport probe: /version only — never enumerates
  // (ADR-121). Errors are sanitized of resolved secret values.
  async testSecrets(
    secrets: Record<string, string>,
    config?: Record<string, unknown>,
    resolvedTarget?: unknown,
  ): Promise<CredentialTestResult> {
    const sanitize = (text: string) =>
      maskSecretValues(text, secrets).slice(0, 200);
    try {
      dockerConfigBase.partial().parse(config ?? {});
      if (!resolvedTarget) {
        return { ok: false, error: "no resolved target profile" };
      }
      const profile = validateTargetProfile(resolvedTarget);
      const docker = new Docker(buildDockerOptions(profile, secrets));
      await docker.version();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: `Docker probe failed: ${sanitize(err instanceof Error ? err.message : String(err))}`,
      };
    }
  }
}
