import Docker from "dockerode";
import {
  canonicalizeSourceIdentity,
  validateDiscoveredAsset,
  type CredentialTestResult,
  type DiscoveredAsset,
  type DiscoveredAssetInstance,
  type Importer,
  type ImporterContext,
} from "@componode/core";
import { maskSecretValues } from "@componode/core/secrets";
import { dockerConfigSchema } from "./config.js";
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
import { mapEngineAsset, type EngineInfo, type EngineVersion } from "./engine.js";

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
  readonly version = "1.0.0";

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

    context.reportPhase("Emitting assets");
    for (const group of groups.values()) {
      if (context.signal.aborted) return;
      const asset = buildAsset(group.identity, group.instances, group.imageRef);
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for workload ${group.identity.externalId}`);
      }
      yield asset;
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
        if (!validateDiscoveredAsset(asset)) {
          throw new Error(`Invalid discovered asset for image ${externalId}`);
        }
        yield asset;
      }
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
      dockerConfigSchema.partial().parse(config ?? {});
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
