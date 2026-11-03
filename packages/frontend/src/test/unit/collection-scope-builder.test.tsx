import { describe, it, expect } from "vitest";
import { uuidv7 } from "uuidv7";
import {
  draftFromScope,
  emptyCollection,
  scopeFromDraft,
  type CollectionDraft,
} from "@/ux/components/importers/collection-scope-builder";

const draft = (over: Partial<CollectionDraft> = {}): CollectionDraft => ({
  sourceKey: uuidv7(),
  components: [
    {
      componentKey: uuidv7(),
      name: "Storefront",
      instances: [
        {
          instanceKey: uuidv7(),
          environment: "PRODUCTION",
          url: "https://example.com",
          region: "",
          version: "",
          check: {
            checkKey: uuidv7(),
            name: "Availability",
            url: "",
            method: "GET",
            enabled: true,
            statuses: "200-299",
            cadence: "",
            target: "",
            targetWindow: "24H",
            autoDisable: "",
            authMode: "NONE",
            credentialId: "",
            usernameKey: "username",
            passwordKey: "password",
            tokenKey: "token",
            headers: [{ name: "", key: "" }],
          },
        },
      ],
    },
  ],
  ...over,
});

describe("collection-scope-builder", () => {
  it("converts a draft to the v2 scope payload with stable keys", () => {
    const d = draft();
    const { scope, error } = scopeFromDraft(d, false);
    expect(error).toBeUndefined();
    expect(scope?.sourceKey).toBe(d.sourceKey);
    const comp = scope?.components[0];
    expect(comp?.componentKey).toBe(d.components[0]!.componentKey);
    const inst = comp?.instances[0];
    expect(inst?.instanceKey).toBe(d.components[0]!.instances[0]!.instanceKey);
    expect(inst?.check.checkKey).toBe(
      d.components[0]!.instances[0]!.check.checkKey,
    );
    expect(inst?.check.successPolicy).toEqual({
      codes: [],
      ranges: [{ min: 200, max: 299 }],
    });
    // Empty check-URL override stays absent — defaults to the instance URL.
    expect(inst?.check.url).toBeUndefined();
  });

  it("round-trips a stored v2 scope through draftFromScope", () => {
    const d = draft();
    const { scope } = scopeFromDraft(d, false);
    const seeded = draftFromScope(scope);
    expect(seeded?.sourceKey).toBe(d.sourceKey);
    expect(seeded?.components[0]!.componentKey).toBe(
      d.components[0]!.componentKey,
    );
    expect(seeded?.components[0]!.instances[0]!.check.statuses).toBe("200-299");
    const reserialized = scopeFromDraft(seeded!, false);
    expect(reserialized.scope).toEqual(scope);
  });

  it("requires a profile name and an instance URL", () => {
    const noName = draft();
    noName.components[0]!.name = "";
    expect(scopeFromDraft(noName, false).error).toMatch(/name is required/);
    const noUrl = draft();
    noUrl.components[0]!.instances[0]!.url = "";
    expect(scopeFromDraft(noUrl, false).error).toMatch(/URL is required/);
  });

  it("forces authMode NONE for web-url scopes", () => {
    const d = draft();
    d.components[0]!.instances[0]!.check.authMode = "BEARER";
    d.components[0]!.instances[0]!.check.credentialId = uuidv7();
    const { scope, error } = scopeFromDraft(d, false);
    expect(error).toBeUndefined();
    expect(scope?.components[0]!.instances[0]!.check.authMode).toBe("NONE");
    expect(scope?.components[0]!.instances[0]!.check.credentialId).toBeNull();
  });

  it("generates a sourceKey and keys on an empty collection", () => {
    const c = emptyCollection();
    expect(c.sourceKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(c.components[0]!.componentKey).not.toBe(c.sourceKey);
  });
});
