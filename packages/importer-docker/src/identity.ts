// externalId construction per contracts/identity-and-mapping.md (ADR-121).
export const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
export const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";

export interface WorkloadIdentity {
  externalId: string;
  kind: "compose" | "override" | "standalone";
  composeProject?: string;
  composeService?: string;
  workloadId?: string;
}

/**
 * Logical workload Component identity: the configured override label
 * (default `componode.component-id`) → `workload:{v}`; else compose
 * project+service labels → `compose:{project}:{service}`; else
 * daemon-qualified container name `{sourceId}::{name}` — never the
 * mutable container ID.
 */
export function workloadIdentity(
  labels: Record<string, string>,
  containerName: string,
  sourceIdentity: string,
  componentIdLabel: string,
): WorkloadIdentity {
  const override = labels[componentIdLabel];
  if (override) {
    return {
      externalId: `workload:${override}`,
      kind: "override",
      workloadId: override,
    };
  }
  const project = labels[COMPOSE_PROJECT_LABEL];
  const service = labels[COMPOSE_SERVICE_LABEL];
  if (project && service) {
    return {
      externalId: `compose:${project}:${service}`,
      kind: "compose",
      composeProject: project,
      composeService: service,
    };
  }
  const name = containerName.replace(/^\/+/, "");
  return { externalId: `${sourceIdentity}::${name}`, kind: "standalone" };
}

export function instanceExternalId(
  sourceIdentity: string,
  containerId: string,
): string {
  return `${sourceIdentity}::${containerId}`;
}
