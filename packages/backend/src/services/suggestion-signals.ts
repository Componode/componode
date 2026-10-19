import type { EdgeSuggestionReason } from "@componode/core";

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
 * Score a (product, component) pair across the three ratified signals.
 * Reason = strongest signal (precedence on ties); score = best signal +
 * 0.05 per additional signal, capped +0.1. Returns null below the floor.
 */
export function scorePair(
  product: SignalProduct,
  component: SignalComponent,
): PairScore | null {
  const productTokens = union(
    tokenize(product.name),
    tokenize(product.slug),
  );
  const componentTokens = union(
    tokenize(component.name),
    tokenize(component.slug),
  );

  const signals: { reason: EdgeSuggestionReason; score: number }[] = [];

  // NAME_MATCH — token-set containment → 1.0; any shared token → 0.5.
  const shared = intersection(productTokens, componentTokens);
  if (shared.length > 0) {
    const contained =
      isSubset(productTokens, componentTokens) ||
      isSubset(componentTokens, productTokens);
    signals.push({ reason: "NAME_MATCH", score: contained ? 1.0 : 0.5 });
  }

  // TOPIC_TAG_MATCH — (product tags + name tokens) vs (component tags +
  // details.topics): 0.5 for the first overlap, +0.1 each extra, cap 0.8.
  const productTagSide = union(productTokens, tokenizeAll(product.tags));
  const componentTagSide = union(
    tokenizeAll(component.tags),
    tokenizeAll(component.details?.["topics"]),
  );
  const tagOverlap = intersection(productTagSide, componentTagSide).length;
  if (tagOverlap > 0) {
    signals.push({
      reason: "TOPIC_TAG_MATCH",
      score: Math.min(0.5 + 0.1 * (tagOverlap - 1), 0.8),
    });
  }

  // NAMESPACE_MATCH — details.namespace token overlap → 0.6.
  const nsTokens = tokenize(
    typeof component.details?.["namespace"] === "string"
      ? (component.details["namespace"] as string)
      : null,
  );
  if (intersection(productTokens, nsTokens).length > 0) {
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
