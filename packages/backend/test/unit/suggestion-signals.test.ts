import { describe, it, expect } from "vitest";
import {
  tokenize,
  prepareProduct,
  prepareComponent,
  scorePrepared,
  SCORE_FLOOR,
  type SignalProduct,
  type SignalComponent,
} from "../../src/services/suggestion-signals.js";

// One-off scoring helper — production code prepares once via
// prepare*/scorePrepared directly (T053); tests compose them here.
const scorePair = (p: SignalProduct, c: SignalComponent) =>
  scorePrepared(prepareProduct(p), prepareComponent(c));

/**
 * Spec 022 / research.md D3 — the three ratified signals, their weights,
 * multi-signal merge, and the staging floor. Pure-function unit tests.
 */
describe("tokenize", () => {
  it("lowercases, splits on non-alphanumerics, drops short tokens", () => {
    expect([...tokenize("Billing-API_v2")].sort()).toEqual([
      "billing",
      "v2",
    ]);
    expect([...tokenize("a-b-cd")]).toEqual(["cd"]);
  });

  it("drops stop-words", () => {
    for (const w of [
      "api",
      "svc",
      "service",
      "app",
      "the",
      "and",
      "for",
      "com",
      "org",
      "net",
      "io",
      "dev",
    ]) {
      expect(tokenize(w).size).toBe(0);
    }
    expect([...tokenize("orders-api")]).toEqual(["orders"]);
  });

  it("handles null/empty input", () => {
    expect(tokenize(null).size).toBe(0);
    expect(tokenize("").size).toBe(0);
  });
});

const product = (over: Partial<Parameters<typeof scorePair>[0]> = {}) => ({
  name: "Billing Service",
  slug: "billing-service",
  tags: [],
  ...over,
});

const component = (
  over: Partial<Parameters<typeof scorePair>[1]> = {},
) => ({
  name: "orders-repo",
  slug: "orders-repo",
  provider: "GITHUB",
  tags: [],
  details: null,
  ...over,
});

describe("scorePair — NAME_MATCH", () => {
  it("scores 1.0 when either token set contains the other", () => {
    const hit = scorePair(
      product({ name: "Billing", slug: "billing" }),
      component({ name: "billing repo", slug: "billing-repo" }),
    );
    expect(hit).toEqual({ reason: "NAME_MATCH", score: 1 });
  });

  it("scores 0.5 on any shared token without containment", () => {
    const hit = scorePair(
      product({ name: "Checkout Billing", slug: "checkout-billing" }),
      component({ name: "billing worker", slug: "billing-worker" }),
    );
    expect(hit).toEqual({ reason: "NAME_MATCH", score: 0.5 });
  });

  it("returns null when nothing matches", () => {
    expect(
      scorePair(product({ name: "Inventory", slug: "inventory" }), component()),
    ).toBeNull();
  });

  it("ignores product slug tokens — FR-004 names the product *name*", () => {
    // Token shared only via the product slug must not match.
    expect(
      scorePair(
        product({ name: "Storefront", slug: "billing-portal" }),
        component({ name: "billing repo", slug: "billing-repo" }),
      ),
    ).toBeNull();
  });
});

describe("scorePair — TOPIC_TAG_MATCH", () => {
  it("scores 0.5 on the first tag/topic overlap", () => {
    const hit = scorePair(
      product({ name: "zz qq", slug: "zz-qq", tags: ["billing"] }),
      component({ tags: ["billing", "golang"] }),
    );
    expect(hit).toEqual({ reason: "TOPIC_TAG_MATCH", score: 0.5 });
  });

  it("adds +0.1 per extra overlap, capped at 0.8", () => {
    const two = scorePair(
      product({ tags: ["billing", "payments"] }),
      component({ tags: ["billing", "payments"] }),
    );
    expect(two).toEqual({ reason: "TOPIC_TAG_MATCH", score: 0.6 });
    const four = scorePair(
      product({ tags: ["a1", "b2", "c3", "d4"] }),
      component({ tags: ["a1", "b2", "c3", "d4"] }),
    );
    expect(four).toEqual({ reason: "TOPIC_TAG_MATCH", score: 0.8 });
  });

  it("reads details.topics and matches product name tokens", () => {
    const hit = scorePair(
      product({ name: "Billing", slug: "billing", tags: [] }),
      component({ details: { topics: ["golang", "billing"] } }),
    );
    expect(hit?.reason).toBe("TOPIC_TAG_MATCH");
  });
});

describe("scorePair — NAMESPACE_MATCH", () => {
  it("scores 0.6 on a shared namespace token (Kubernetes only)", () => {
    const hit = scorePair(
      product({ name: "Inventory Hub", slug: "inventory-hub" }),
      component({
        provider: "KUBERNETES",
        details: { namespace: "prod-inventory" },
      }),
    );
    expect(hit).toEqual({ reason: "NAMESPACE_MATCH", score: 0.6 });
  });

  it("ignores details.namespace on non-Kubernetes components (FR-004c)", () => {
    const hit = scorePair(
      product({ name: "Inventory Hub", slug: "inventory-hub" }),
      component({
        provider: "GITHUB",
        details: { namespace: "prod-inventory" },
      }),
    );
    expect(hit).toBeNull();
  });
});

describe("scorePair — multi-signal merge and floor", () => {
  it("adds +0.05 per extra signal, capped at +0.1, reason = strongest", () => {
    // NAME_MATCH (1.0) + NAMESPACE_MATCH (0.6) + TOPIC_TAG_MATCH (0.5):
    // score 1.0 + min(2 * 0.05, 0.1) = 1.1.
    const hit = scorePair(
      product({ name: "Billing", slug: "billing", tags: ["billing"] }),
      component({
        name: "billing repo",
        slug: "billing-repo",
        provider: "KUBERNETES",
        details: { namespace: "billing", topics: ["billing"] },
      }),
    );
    expect(hit).toEqual({ reason: "NAME_MATCH", score: 1.1 });
  });

  it("keeps NAME_MATCH reason over equal-score ties by precedence", () => {
    // NAME_MATCH partial (0.5) + TOPIC (0.5): precedence picks NAME_MATCH.
    const hit = scorePair(
      product({ name: "Checkout Billing", slug: "checkout-billing" }),
      component({
        name: "billing worker",
        slug: "billing-worker",
        tags: ["checkout"],
      }),
    );
    expect(hit?.reason).toBe("NAME_MATCH");
    expect(hit?.score).toBe(0.55);
  });

  it("never stages below the floor", () => {
    expect(SCORE_FLOOR).toBe(0.5);
    // A degenerate pair with no signal at all returns null.
    expect(
      scorePair(
        product({ name: "xx", slug: "xx" }),
        component({ name: "yy", slug: "yy" }),
      ),
    ).toBeNull();
  });
});
