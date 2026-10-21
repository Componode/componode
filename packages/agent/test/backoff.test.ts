import { describe, it, expect } from "vitest";
import { Backoff } from "../src/backoff.js";

// Spec 025 US5 / T038: exponential backoff with jitter, cap, and reset.

describe("Backoff", () => {
  it("grows exponentially", () => {
    const b = new Backoff({ initialMs: 100, factor: 2, maxMs: 60_000, jitterRatio: 0 });
    const delays = [b.next(), b.next(), b.next(), b.next()];
    expect(delays).toEqual([100, 200, 400, 800]);
  });

  it("caps at maxMs", () => {
    const b = new Backoff({ initialMs: 1000, factor: 10, maxMs: 5000, jitterRatio: 0 });
    expect(b.next()).toBe(1000);
    expect(b.next()).toBe(5000);
    expect(b.next()).toBe(5000);
  });

  it("applies jitter within the configured ratio", () => {
    const b = new Backoff({ initialMs: 1000, factor: 2, maxMs: 60_000, jitterRatio: 0.25 });
    for (let i = 0; i < 50; i++) {
      const d = new Backoff({ initialMs: 1000, factor: 2, maxMs: 60_000, jitterRatio: 0.25 }).next();
      expect(d).toBeGreaterThanOrEqual(750);
      expect(d).toBeLessThanOrEqual(1250);
    }
    void b;
  });

  it("resets after a successful connection", () => {
    const b = new Backoff({ initialMs: 100, factor: 2, maxMs: 60_000, jitterRatio: 0 });
    b.next();
    b.next();
    b.reset();
    expect(b.next()).toBe(100);
  });
});
