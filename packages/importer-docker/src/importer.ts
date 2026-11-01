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
import { mapContainer, buildAsset, type ContainerInspect } from "./mapping.js";
import { type WorkloadIdentity } from "./identity.js";

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
    const info = (await docker.info()) as {
      ID?: string;
      Name?: string;
    };
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
      const seen = new Set<string>();
      for (const image of images) {
        if (context.signal.aborted) return;
        // External IDs carry the raw ref — `docker-image:{repo@sha256:…}`
        // for digests, `docker-image:{repo:tag}` for tags (ADR-121 #6).
        const refs = image.RepoDigests?.length
          ? image.RepoDigests
          : (image.RepoTags ?? []).filter((t) => t !== "<none>:<none>");
        for (const ref of refs) {
          const externalId = `docker-image:${ref}`;
          if (seen.has(externalId)) continue;
          seen.add(externalId);
          const asset: DiscoveredAsset = {
            category: "PACKAGE_REGISTRY",
            provider: "DOCKER",
            resourceType: "image",
            name: ref,
            externalId,
            details: {
              imageId: image.Id,
              size: image.Size,
              created: image.Created,
            },
            instances: [],
          };
          if (!validateDiscoveredAsset(asset)) {
            throw new Error(`Invalid discovered asset for image ${ref}`);
          }
          yield asset;
        }
      }
    }

    context.reportPhase("Completed");
  }

  // Minimal per-transport probe: ping/version only — never enumerates
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
