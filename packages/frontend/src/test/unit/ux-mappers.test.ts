import { describe, it, expect } from "vitest";
import {
  mapProduct,
  mapComponent,
  mapComponentInstance,
  mapComponentGroup,
} from "@/api/mappers/catalog";
import type {
  DigitalProduct,
  Component as ApiComponent,
  ComponentInstance as ApiInstance,
  ComponentWithInstances,
  ComponentGroup as ApiGroup,
} from "@/api/types";

const product: DigitalProduct = {
  id: "p1",
  name: "Checkout",
  slug: "checkout",
  type: "CUSTOMER_FACING",
  lifecycle: "ACTIVE",
  status: "RUNNING",
  criticality: "HIGH",
  description: "Customer checkout flow",
  lobOwnerName: "Retail",
  teamOwnerName: "Payments",
  tags: ["tier-1"],
  links: [{ title: "Repo", url: "https://example.com" }],
  sunsetAt: null,
  consumedByCount: 3,
  completeness: { owner: true, description: true, dependencies: false },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-02-01T00:00:00Z",
};

const component: ApiComponent = {
  id: "c1",
  name: "Orders DB",
  slug: "orders-db",
  category: "DATABASE",
  provider: "AWS",
  resourceType: "rds:db",
  lifecycle: "ACTIVE",
  componentGroupId: "g1",
  componentGroupName: "Data stores",
  teamOwnerName: "Payments",
  tags: ["sql"],
  sunsetAt: null,
  instanceCount: 2,
};

const instance: ApiInstance = {
  id: "i1",
  componentId: "c1",
  environment: "PRODUCTION",
  url: "https://db.example.com",
  region: "us-east-1",
  status: "RUNNING",
  version: "16.4",
  deployedAt: "2026-01-15T00:00:00Z",
  externalId: "arn:aws:rds:db",
  slug: "orders-db-prod",
  lastSeenAt: "2026-02-01T00:00:00Z",
};

describe("mapProduct", () => {
  it("maps a detail product with componentCount from counts", () => {
    const view = mapProduct(product, { componentCount: 24 });
    expect(view.slug).toBe("checkout");
    expect(view.type).toBe("CUSTOMER_FACING");
    expect(view.status).toBe("RUNNING");
    expect(view.componentCount).toBe(24);
    expect(view.completeness).toEqual({ owner: true, description: true, dependencies: false });
  });

  it("falls back safely on nulls and missing facets", () => {
    const bare: DigitalProduct = {
      ...product,
      description: null,
      lobOwnerName: null,
      teamOwnerName: null,
      criticality: null,
      status: null,
      tags: undefined,
      links: undefined,
      completeness: undefined,
      sunsetAt: undefined,
      consumedByCount: undefined,
    };
    const view = mapProduct(bare);
    expect(view.description).toBeNull();
    expect(view.lobOwnerName).toBeNull();
    expect(view.criticality).toBeNull();
    expect(view.status).toBeNull();
    expect(view.tags).toEqual([]);
    expect(view.links).toEqual([]);
    expect(view.sunsetAt).toBeNull();
    expect(view.consumedByCount).toBeUndefined();
    expect(view.completeness).toEqual({ owner: false, description: false, dependencies: false });
    expect(view.componentCount).toBe(0);
  });

  it("narrows unknown enums to neutral fallbacks", () => {
    const weird = { ...product, type: "WIDGET" as string, lifecycle: "ARCHIVED" as string };
    const view = mapProduct(weird);
    expect(view.type).toBe("CUSTOMER_FACING");
    expect(view.lifecycle).toBe("ACTIVE");
  });
});

describe("mapComponent", () => {
  it("maps fields and carries instances when present", () => {
    const withInstances: ComponentWithInstances = {
      ...component,
      externalId: null,
      details: null,
      lastSeenAt: "2026-02-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
      instances: [instance],
    };
    const view = mapComponent(withInstances);
    expect(view.instances).toHaveLength(1);
    expect(view.instances[0]?.environment).toBe("PRODUCTION");
    expect(view.componentGroupName).toBe("Data stores");
    expect(view.instanceCount).toBe(2);
  });

  it("defaults missing names/tags and null lastSeenAt", () => {
    const bare: ApiComponent = {
      ...component,
      componentGroupName: null,
      teamOwnerName: undefined,
      tags: undefined,
      sunsetAt: undefined,
    };
    const view = mapComponent(bare);
    expect(view.componentGroupName).toBeNull();
    expect(view.teamOwnerName).toBeNull();
    expect(view.tags).toEqual([]);
    expect(view.sunsetAt).toBeNull();
    expect(view.instances).toEqual([]);
    expect(view.lastSeenAt).toBeNull();
  });

  it("narrows unknown provider/lifecycle to neutral fallbacks", () => {
    const weird = { ...component, provider: "ORACLE" as string, lifecycle: "ARCHIVED" as string };
    const view = mapComponent(weird);
    expect(view.provider).toBe("OTHER");
    expect(view.lifecycle).toBe("ACTIVE");
  });
});

describe("mapComponentInstance", () => {
  it("maps all fields", () => {
    const view = mapComponentInstance(instance);
    expect(view.environment).toBe("PRODUCTION");
    expect(view.status).toBe("RUNNING");
    expect(view.version).toBe("16.4");
    expect(view.lastSeenAt).toBe("2026-02-01T00:00:00Z");
  });

  it("narrows unknown environment/status and tolerates nulls", () => {
    const weird = {
      ...instance,
      environment: "MOON" as string,
      status: "FLAPPING" as string,
      version: null,
      url: null,
      region: null,
      lastSeenAt: null,
    };
    const view = mapComponentInstance(weird);
    expect(view.environment).toBe("OTHER");
    expect(view.status).toBe("GONE");
    expect(view.version).toBeNull();
    expect(view.lastSeenAt).toBeNull();
  });
});

describe("mapComponentGroup", () => {
  it("maps fields with memberCount", () => {
    const group: ApiGroup = {
      id: "g1",
      name: "Data stores",
      slug: "data-stores",
      description: "Shared stateful components",
      lifecycle: "ACTIVE",
      teamOwnerName: "Payments",
      memberCount: 7,
    };
    const view = mapComponentGroup(group);
    expect(view.slug).toBe("data-stores");
    expect(view.members).toBe(7);
    expect(view.team).toBe("Payments");
  });
});

import {
  mapAgentSession,
  mapCredential,
  mapCredentialStatus,
  mapImportAgent,
  mapImporterConfig,
  mapImportRun,
  mapRunChange,
  mapRunError,
} from "@/api/mappers/operations";

describe("mapImporterConfig", () => {
  const apiConfig = {
    id: "ic1",
    importerName: "github",
    label: "GitHub: componode",
    scope: {},
    secretRefs: [],
    credentialIds: ["cr1"],
    secretRefsDeprecated: false,
    agentId: null,
    agent: null,
    agentIncompatible: false,
    schedule: "0 */6 * * *",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z",
  };

  it("maps importer name to Provider and derives scheduleLabel", () => {
    const view = mapImporterConfig(apiConfig, []);
    expect(view.importerName).toBe("GITHUB");
    expect(view.scheduleLabel).toBe("Every 6 hours");
    expect(view.enabled).toBe(true);
    expect(view.history).toEqual([]);
  });

  it("joins credentialIds to a credential label", () => {
    const view = mapImporterConfig(apiConfig, [
      { id: "cr1", label: "prod-ro", slug: "prod-ro" },
    ] as never);
    expect(view.credentialLabel).toBe("prod-ro");
  });

  it("falls back when no credential or schedule", () => {
    const view = mapImporterConfig(
      { ...apiConfig, credentialIds: [], schedule: null },
      [],
    );
    expect(view.credentialLabel).toBe("None");
    expect(view.scheduleLabel).toBe("Manual only");
  });
});

describe("mapImportRun", () => {
  const apiRun = {
    id: "r1",
    configId: "ic1",
    agentId: null,
    agentName: null,
    status: "COMPLETED",
    triggeredBy: "alice",
    startedAt: "2026-02-01T00:00:00Z",
    completedAt: "2026-02-01T00:02:00Z",
    assetsProcessed: 10,
    assetsCreated: 4,
    assetsUpdated: 6,
    instancesOrphaned: 1,
    componentsRetired: 0,
    currentPhase: null,
    cancelRequestedAt: null,
    errorMessage: null,
    errorStack: null,
    errorType: null,
    credentialIds: null,
    createdAt: "2026-02-01T00:00:00Z",
  };

  it("derives durationSec from timestamps", () => {
    const view = mapImportRun(apiRun as never);
    expect(view.durationSec).toBe(120);
    expect(view.status).toBe("COMPLETED");
  });

  it("handles a pending run with no start", () => {
    const view = mapImportRun({
      ...apiRun,
      status: "PENDING",
      startedAt: null,
      completedAt: null,
    } as never);
    expect(view.startedAt).toBeNull();
    expect(view.durationSec).toBeNull();
  });

  it("maps unknown statuses to INTERRUPTED-safe fallback", () => {
    const view = mapImportRun({ ...apiRun, status: "WEIRD" } as never);
    expect(view.status).toBe("FAILED");
  });
});

describe("mapImportAgent", () => {
  const apiAgent = {
    id: "a1",
    name: "edge-1",
    status: "CONNECTED",
    agentVersion: "1.4.0",
    protocolVersion: 2,
    importerVersions: [{ name: "github", version: "1.0.0" }],
    allowedImporters: [],
    maxConcurrentJobs: 2,
    lastSeenAt: "2026-02-01T00:00:00Z",
    revokedAt: null,
    reportedStatus: null,
    lastHeartbeatAt: "2026-02-01T00:05:00Z",
    lastDisconnectReason: null,
    hasCredential: true,
    pendingEnrollment: false,
    boundConfigCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("derives ACTIVE credential state and flattens importer versions", () => {
    const view = mapImportAgent(apiAgent as never);
    expect(view.credentialState).toBe("ACTIVE");
    expect(view.importerVersions).toEqual({ github: "1.0.0" });
    expect(view.boundConfigs).toBe(3);
    expect(view.lastHeartbeatAt).toBe("2026-02-01T00:05:00Z");
  });

  it("derives PENDING_ENROLLMENT when no credential and a token waits", () => {
    const view = mapImportAgent({
      ...apiAgent,
      hasCredential: false,
      pendingEnrollment: true,
    } as never);
    expect(view.credentialState).toBe("PENDING_ENROLLMENT");
  });

  it("derives REVOKED from revokedAt", () => {
    const view = mapImportAgent({
      ...apiAgent,
      revokedAt: "2026-02-02T00:00:00Z",
    } as never);
    expect(view.credentialState).toBe("REVOKED");
  });
});

describe("mapRunChange / mapRunError", () => {
  it("maps an entity change to a RunChange row", () => {
    const view = mapRunChange({
      id: "e1",
      entityType: "component",
      entityId: "c1",
      action: "created",
      createdByName: "importer",
      createdAt: "2026-02-01T00:00:00Z",
    } as never);
    expect(view.entityKind).toBe("component");
    expect(view.action).toBe("created");
    expect(view.actor).toBe("importer");
  });

  it("maps a run error row", () => {
    const view = mapRunError({
      id: "re1",
      runId: "r1",
      assetExternalId: "gh:componode",
      errorType: "SKIPPED",
      errorMessage: "missing scope",
      createdAt: "2026-02-01T00:00:00Z",
    } as never);
    expect(view.errorMessage).toBe("missing scope");
    expect(view.assetExternalId).toBe("gh:componode");
  });
});

import { mapSession, mapUser } from "@/api/mappers/operations";
import { mapActivityItem, mapAttentionItem, mapCoverage } from "@/api/mappers/dashboard";
import { mapDepComponent } from "@/api/mappers/catalog";
import { mapSuggestion } from "@/api/mappers/suggestions";

describe("mapUser", () => {
  it("passes through nullable fields as null", () => {
    const view = mapUser({
      id: "u1",
      username: "alice",
      role: "EDITOR",
      displayName: null,
      email: null,
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
    } as never);
    expect(view.displayName).toBeNull();
    expect(view.email).toBeNull();
    expect(view.role).toBe("EDITOR");
    expect(view.lastActiveAt).toBeNull();
  });

  it("falls back to VIEWER on an unknown role", () => {
    const view = mapUser({
      id: "u2",
      username: "bob",
      role: "SUPERUSER",
      displayName: "Bob",
      email: "b@x.io",
      isActive: false,
      createdAt: "2026-01-01T00:00:00Z",
    } as never);
    expect(view.role).toBe("VIEWER");
  });
});

describe("mapSession", () => {
  it("maps timestamps, device/ip, and the current marker", () => {
    const view = mapSession(
      {
        id: "s1",
        device: "Chrome · Windows",
        ip: "10.0.0.5",
        current: true,
        createdAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-02-01T00:00:00Z",
        expiresAt: "2026-03-01T00:00:00Z",
      },
      { username: "alice", displayName: "Alice A" },
    );
    expect(view.username).toBe("alice");
    expect(view.displayName).toBe("Alice A");
    expect(view.device).toBe("Chrome · Windows");
    expect(view.location).toBe("10.0.0.5");
    expect(view.current).toBe(true);
  });

  it("renders missing metadata as em-dash placeholders", () => {
    const view = mapSession(
      {
        id: "s2",
        device: null,
        ip: null,
        current: false,
        createdAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-02-01T00:00:00Z",
        expiresAt: "2026-03-01T00:00:00Z",
      },
      { username: "alice", displayName: "Alice A" },
    );
    expect(view.device).toBe("—");
    expect(view.location).toBe("—");
    expect(view.current).toBe(false);
  });
});

describe("mapActivityItem fallback", () => {
  it("unknown action/entityType fall back to other", () => {
    const view = mapActivityItem({
      kind: "entity",
      id: "e9",
      entityType: "mystery",
      entityId: "x",
      action: "teleported",
      changes: null,
      createdByName: "system",
      createdAt: "2026-02-01T00:00:00Z",
    } as never);
    expect(view.action).toBe("other");
    expect(view.entityKind).toBe("other");
  });
});

describe("mapCredential", () => {
  it("maps kind and status without inventing provider fields", () => {
    const c = mapCredential(
      {
        id: "c1",
        slug: "gh-ro",
        label: "GitHub read-only",
        status: "ACTIVE",
        kind: "AGENT_MANAGED",
        keyHints: { token: "env" },
        expiresAt: null,
        lastUsedAt: null,
        updatedBy: "admin",
      },
      3,
    );
    expect(c.kind).toBe("AGENT_MANAGED");
    expect(c.status).toBe("ACTIVE");
    expect(c.usedBy).toBe(3);
    expect(c).not.toHaveProperty("provider");
  });

  it("normalizes unknown status/kind to safe defaults", () => {
    const c = mapCredential({
      id: "c2", slug: "x", label: "x", status: "BOGUS", kind: "BOGUS",
      keyHints: {}, expiresAt: null, lastUsedAt: null,
    });
    expect(c.status).toBe("ACTIVE");
    expect(c.kind).toBe("STORED");
    expect(c.usedBy).toBe(0);
  });
});

describe("mapCredentialStatus", () => {
  it("passes through known statuses and defaults unknowns to ACTIVE", () => {
    expect(mapCredentialStatus("REVOKED")).toBe("REVOKED");
    expect(mapCredentialStatus("WEIRD")).toBe("ACTIVE");
    expect(mapCredentialStatus(null)).toBe("ACTIVE");
  });
});

describe("mapImportRun errorType", () => {
  it("carries failure classification (AGENT_LOST) into the view", () => {
    const r = mapImportRun({
      id: "r1", configId: "c1", agentId: null, agentName: null,
      status: "FAILED", triggeredBy: "admin",
      startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z",
      assetsProcessed: 4, assetsCreated: 1, assetsUpdated: 3,
      instancesOrphaned: 0, componentsRetired: 0, currentPhase: null,
      cancelRequestedAt: null, errorMessage: "session dropped",
      errorType: "AGENT_LOST", credentialIds: null, createdAt: "2026-01-01T00:00:00Z",
    } as never);
    expect(r.errorType).toBe("AGENT_LOST");
  });
});

describe("mapAgentSession", () => {
  it("narrows disconnect reasons and falls back for unknowns", () => {
    const s = mapAgentSession({
      id: "s1", agentId: "a1", connectedAt: "2026-01-01T00:00:00Z",
      disconnectedAt: "2026-01-01T01:00:00Z", disconnectReason: "superseded",
      remoteAddress: null, agentVersion: null,
    });
    expect(s.reason).toBe("superseded");
    expect(s.remoteAddress).toBe("—");
    const u = mapAgentSession({
      id: "s2", agentId: "a1", connectedAt: "t", disconnectedAt: null,
      disconnectReason: "bogus_reason", remoteAddress: "10.0.0.1", agentVersion: "1.0.0",
    });
    expect(u.reason).toBeNull();
  });
});

describe("mapSuggestion", () => {
  it("maps staged DEPENDS_ON pairs with confidence banding", () => {
    const s = mapSuggestion({
      id: "sug1",
      product: { name: "Checkout" },
      component: { name: "postgres-db" },
      reason: null,
      score: 0.9,
    } as never);
    expect(s.kind).toBe("DEPENDS_ON");
    expect(s.from).toBe("Checkout");
    expect(s.to).toBe("postgres-db");
    expect(s.confidence).toBeDefined();
  });
});

describe("mapAttentionItem", () => {
  it("marks FAILED_RUN destructive, others warning", () => {
    expect(mapAttentionItem({ kind: "FAILED_RUN", label: "x", href: "/a", at: null } as never).tone).toBe("destructive");
    expect(mapAttentionItem({ kind: "UNWIRED", label: "x", href: "/a", at: null } as never).tone).toBe("warning");
  });
});

describe("mapCoverage", () => {
  it("computes per-facet percentages; null when total is 0", () => {
    expect(mapCoverage({
      products: { total: 10, missingOwner: 2, missingDescription: 0, missingDependencies: 5 },
    } as never)).toEqual({ owner: 80, description: 100, dependencies: 50 });
    expect(mapCoverage({
      products: { total: 0, missingOwner: 0, missingDescription: 0, missingDependencies: 0 },
    } as never)).toEqual({ owner: null, description: null, dependencies: null });
  });
});

describe("mapDepComponent", () => {
  it("joins the dep ref with catalog rows for provider/resourceType", () => {
    const row = mapDepComponent(
      { id: "c1", name: "pg", slug: "pg", category: "database", lifecycle: "ACTIVE", sources: ["COMPOSES"] } as never,
      [{ id: "c1", provider: "AWS", resourceType: "rds", instanceCount: 2, componentGroupName: "data" } as never],
    );
    expect(row.provider).toBe("AWS");
    expect(row.resourceType).toBe("rds");
    expect(row.componentGroupName).toBe("data");
  });
});
