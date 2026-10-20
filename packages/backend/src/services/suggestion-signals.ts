import type {
  ComponentProvider,
  EdgeSuggestionReason,
} from "@componode/core";

/**
 * Spec 022 / research.md D3 — the three ratified suggestion signals, their
 * weights, the multi-signal merge, and the staging floor. Pure functions;
 * no database imports so the engine is unit-testable in isolation.
 */

const STOP_WORDS = new Set([
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
]);

/** Lowercase, split on `[^a-z0-9]+`, drop <2-char tokens and stop-words. */
export function tokenize(value: string | null | undefined): Set<string> {
  const tokens = new Set<string>();
  if (!value) return tokens;
  for (const t of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length >= 2 && !STOP_WORDS.has(t)) tokens.add(t);
  }
  return tokens;
}

function union(...sets: Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) for (const t of s) out.add(t);
  return out;
}

function intersection(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((t) => b.has(t));
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  return a.size > 0 && [...a].every((t) => b.has(t));
}

function tokenizeAll(values: unknown): Set<string> {
  const tokens = new Set<string>();
  if (!Array.isArray(values)) return tokens;
  for (const v of values) {
    if (typeof v === "string") for (const t of tokenize(v)) tokens.add(t);
  }
  return tokens;
}

export interface SignalProduct {
  name: string;
  slug: string;
  tags: string[] | null;
}

export interface SignalComponent {
  name: string;
  slug: string;
  provider: ComponentProvider;
  tags: string[] | null;
  details: Record<string, unknown> | null;
}

export interface PairScore {
  reason: EdgeSuggestionReason;
  /** Decimal score, e.g. 1.05. */
  score: number;
}

const REASON_PRECEDENCE: EdgeSuggestionReason[] = [
  "NAME_MATCH",
  "NAMESPACE_MATCH",
  "TOPIC_TAG_MATCH",
];

/** Merge floor — hits below this are never staged (research.md D3). */
export const SCORE_FLOOR = 0.5;

/**
 * Order-insensitive tag-set comparison — used by write-path triggers to
 * tell whether a tag field actually changed (ADR-113 scoped passes).
 */
export function tagsDiffer(
  next: readonly string[],
  prev: readonly string[],
): boolean {
  if (next.length !== prev.length) return true;
  const a = [...next].sort();
  const b = [...prev].sort();
  return a.some((t, i) => t !== b[i]);
}

/**
 * Per-entity token sets, computed once and reused across the whole
 * product×component scoring matrix (SC-002 — a whole-catalog pass must
 * not re-tokenize each entity for every pair).
 */
export interface PreparedProduct {
  nameTokens: Set<string>;
  tagSide: Set<string>;
}

export interface PreparedComponent {
  nameTokens: Set<string>;
  tagSide: Set<string>;
  nsTokens: Set<string>;
}

export function prepareProduct(product: SignalProduct): PreparedProduct {
  // FR-004 lists the product's *name* (and tags) — the slug is not a
  // signal source on the product side.
  const nameTokens = tokenize(product.name);
  return {
    nameTokens,
    tagSide: union(nameTokens, tokenizeAll(product.tags)),
  };
}

export function prepareComponent(component: SignalComponent): PreparedComponent {
  return {
    nameTokens: union(tokenize(component.name), tokenize(component.slug)),
    tagSide: union(
      tokenizeAll(component.tags),
      tokenizeAll(component.details?.["topics"]),
    ),
    // FR-004(c): only a Kubernetes component's imported namespace counts.
    nsTokens:
      component.provider === "KUBERNETES"
        ? tokenize(
            typeof component.details?.["namespace"] === "string"
              ? (component.details["namespace"] as string)
              : null,
          )
        : new Set<string>(),
  };
}

/**
 * Score a prepared (product, component) pair across the three ratified
 * signals. Reason = strongest signal (precedence on ties); score = best
 * signal + 0.05 per additional signal, capped +0.1. Null below the floor.
 */
export function scorePrepared(
  product: PreparedProduct,
  component: PreparedComponent,
): PairScore | null {
  const signals: { reason: EdgeSuggestionReason; score: number }[] = [];

  // NAME_MATCH — token-set containment → 1.0; any shared token → 0.5.
  const shared = intersection(product.nameTokens, component.nameTokens);
  if (shared.length > 0) {
    const contained =
      isSubset(product.nameTokens, component.nameTokens) ||
      isSubset(component.nameTokens, product.nameTokens);
    signals.push({ reason: "NAME_MATCH", score: contained ? 1.0 : 0.5 });
  }

  // TOPIC_TAG_MATCH — (product tags + name tokens) vs (component tags +
  // details.topics): 0.5 for the first overlap, +0.1 each extra, cap 0.8.
  const tagOverlap = intersection(product.tagSide, component.tagSide).length;
  if (tagOverlap > 0) {
    signals.push({
      reason: "TOPIC_TAG_MATCH",
      score: Math.min(0.5 + 0.1 * (tagOverlap - 1), 0.8),
    });
  }

  // NAMESPACE_MATCH — details.namespace token overlap → 0.6.
  if (intersection(product.nameTokens, component.nsTokens).length > 0) {
    signals.push({ reason: "NAMESPACE_MATCH", score: 0.6 });
  }

  if (signals.length === 0) return null;

  let best = signals[0]!;
  for (const s of signals) {
    if (
      s.score > best.score ||
      (s.score === best.score &&
        REASON_PRECEDENCE.indexOf(s.reason) <
          REASON_PRECEDENCE.indexOf(best.reason))
    ) {
      best = s;
    }
  }
  const score = Math.min(
    best.score + 0.05 * (signals.length - 1),
    best.score + 0.1,
  );
  if (score < SCORE_FLOOR) return null;
  return { reason: best.reason, score: Math.round(score * 100) / 100 };
}
