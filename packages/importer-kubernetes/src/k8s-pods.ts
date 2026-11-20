import {
  fetchImageBom,
  parseRepoDigest,
  type BomCapabilityMarker,
  type DiscoveredBomEntry,
} from "@componode/core";

// Spec 073 / FR-016 — pod image SBOMs on workload assets. The placeholder
// importer emits one CONTAINER_ORCHESTRATION asset per configured
// `apiVersion:Kind`; when `includePodImageSbom` is on and `endpoint` is
// set, pods in the namespace are resolved to their owning workload
// (ReplicaSet → Deployment chains fetched once per RS) and each pod's
// `spec.containers[].image` SBOM attaches to that workload's asset.
//
// Tag refs can't query referrers — the pod's `status.containerStatuses[].
// imageID` carries the pullable digest (`<scheme>://repo@sha256:…`).
// Entries land on the workload asset (component scope) with
// `evidenceDetail = "k8s:pod-spec:image:{spec.containers[].image}"`.

interface K8sOwnerRef {
  kind?: string;
  name?: string;
}

interface K8sPod {
  metadata?: { name?: string; ownerReferences?: K8sOwnerRef[] };
  spec?: {
    containers?: { name?: string; image?: string }[];
    initContainers?: { name?: string; image?: string }[];
  };
  status?: {
    containerStatuses?: { name?: string; imageID?: string }[];
    initContainerStatuses?: { name?: string; imageID?: string }[];
  };
}

interface K8sPodList {
  items?: K8sPod[];
}

async function apiGet(
  endpoint: string,
  path: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(`${endpoint.replace(/\/$/, "")}${path}`, {
    headers,
    signal,
  });
  if (!resp.ok) {
    const err = new Error(`k8s GET ${path} → ${resp.status}`) as Error & {
      status?: number;
    };
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

/** `docker-pullable://repo@sha256:…` → `repo@sha256:…` */
function pullableDigest(imageID: string | undefined): string | null {
  if (!imageID) return null;
  const idx = imageID.indexOf("://");
  const candidate = idx >= 0 ? imageID.slice(idx + 3) : imageID;
  return parseRepoDigest(candidate) ? candidate : null;
}

export interface PodImageBom {
  entries?: DiscoveredBomEntry[];
  marker: BomCapabilityMarker;
}

function worstMarker(a: BomCapabilityMarker, b: BomCapabilityMarker): BomCapabilityMarker {
  const rank = { OK: 0, UNAVAILABLE: 1, FORBIDDEN: 2, ERROR: 3 } as const;
  return rank[b.status] > rank[a.status] ? b : a;
}

/**
 * Maps each configured `apiVersion:Kind` workload key to the union of its
 * pods' resolved image SBOMs. Returns a map keyed by the same string
 * `buildAsset` uses for `resourceType` — keys absent from the map mean the
 * workload had no pods (field stays absent, marker not written).
 */
export async function collectPodImageBoms(opts: {
  endpoint: string;
  namespace: string;
  resourceTypes: string[];
  token?: string;
  signal: AbortSignal;
}): Promise<{ perWorkload: Map<string, PodImageBom>; marker: BomCapabilityMarker }> {
  const { endpoint, namespace, resourceTypes, token, signal } = opts;
  const ns = encodeURIComponent(namespace);
  const wanted = new Set(
    resourceTypes.filter((rt) => rt.split(":", 2).every(Boolean)),
  );

  const podList = (await apiGet(
    endpoint,
    `/api/v1/namespaces/${ns}/pods`,
    token,
    signal,
  )) as K8sPodList;

  // pod → workload key, resolving ReplicaSet owners one hop up to the
  // Deployment (cached per RS name).
  const ownerKindCache = new Map<string, string | null>();
  const resolveWorkloadKey = async (pod: K8sPod): Promise<string | null> => {
    const owner = pod.metadata?.ownerReferences?.[0];
    if (!owner?.kind || !owner.name) return null;
    let kind = owner.kind;
    if (kind === "ReplicaSet") {
      const cacheKey = owner.name;
      if (!ownerKindCache.has(cacheKey)) {
        try {
          const rs = (await apiGet(
            endpoint,
            `/apis/apps/v1/namespaces/${ns}/replicasets/${encodeURIComponent(owner.name)}`,
            token,
            signal,
          )) as K8sPod;
          ownerKindCache.set(
            cacheKey,
            rs.metadata?.ownerReferences?.[0]?.kind ?? null,
          );
        } catch {
          ownerKindCache.set(cacheKey, null);
        }
      }
      kind = ownerKindCache.get(cacheKey) ?? kind;
    }
    // Find the configured resourceType matching this kind. Deployments and
    // other apps/v1 workloads dominate; fall back across apiVersions.
    for (const rt of wanted.keys()) {
      if (rt.endsWith(`:${kind}`)) return rt;
    }
    return null;
  };

  // workloadKey → specImage → digestRef|null (deduped)
  const imagesByWorkload = new Map<string, Map<string, string | null>>();
  const digestByContainer = (pod: K8sPod, name: string | undefined) => {
    const statuses = [
      ...(pod.status?.containerStatuses ?? []),
      ...(pod.status?.initContainerStatuses ?? []),
    ];
    const status = statuses.find((s) => s.name === name) ?? statuses[0];
    return pullableDigest(status?.imageID);
  };

  for (const pod of podList.items ?? []) {
    if (signal.aborted) break;
    const workloadKey = await resolveWorkloadKey(pod);
    if (!workloadKey) continue;
    const containers = [
      ...(pod.spec?.containers ?? []),
      ...(pod.spec?.initContainers ?? []),
    ];
    for (const container of containers) {
      const image = container.image;
      if (!image) continue;
      const perImage =
        imagesByWorkload.get(workloadKey) ?? new Map<string, string | null>();
      if (!perImage.has(image)) {
        perImage.set(
          image,
          parseRepoDigest(image) ? image : digestByContainer(pod, container.name),
        );
      }
      imagesByWorkload.set(workloadKey, perImage);
    }
  }

  // Fetch each unique digest's SBOM once per run (image → several pods).
  const bomByDigest = new Map<string, Awaited<ReturnType<typeof fetchImageBom>>>();
  const perWorkload = new Map<string, PodImageBom>();
  let runMarker: BomCapabilityMarker = { status: "OK" };

  for (const [workloadKey, images] of imagesByWorkload) {
    const entries: DiscoveredBomEntry[] = [];
    let marker: BomCapabilityMarker = { status: "OK" };
    let resolved = 0;
    for (const [image, digestRef] of images) {
      if (!digestRef) {
        marker = worstMarker(marker, {
          status: "UNAVAILABLE",
          message: `pod image ${image} has no resolvable digest`,
        });
        continue;
      }
      let result = bomByDigest.get(digestRef);
      if (!result) {
        result = await fetchImageBom(digestRef);
        bomByDigest.set(digestRef, result);
      }
      if (result.entries) {
        resolved++;
        for (const e of result.entries) {
          entries.push({
            ...e,
            // k8s evidenceDetail names the spec image ref (FR-016) — the
            // referrers path stamped the digest form; restamp per image.
            evidenceDetail: `k8s:pod-spec:image:${image}`,
          });
        }
      } else {
        marker = worstMarker(marker, result.marker);
      }
    }
    // Marker semantics: OK when at least one image resolved an SBOM;
    // otherwise the worst reason none did. Partial coverage stays honest
    // via evidenceDetail — every entry names its image.
    const finalMarker: BomCapabilityMarker =
      resolved > 0 ? { status: "OK" } : marker;
    if (entries.length) {
      perWorkload.set(workloadKey, { entries, marker: finalMarker });
    } else {
      perWorkload.set(workloadKey, { marker: finalMarker });
    }
    runMarker = worstMarker(runMarker, finalMarker);
  }

  return { perWorkload, marker: runMarker };
}
