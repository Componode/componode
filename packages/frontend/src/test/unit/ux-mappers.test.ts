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
