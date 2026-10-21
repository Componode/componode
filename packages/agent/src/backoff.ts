// Reconnect backoff (spec 025 US5): exponential with full-range jitter and a
// cap; reset after a successfully established session.

export interface BackoffOptions {
  initialMs?: number;
  factor?: number;
  maxMs?: number;
  jitterRatio?: number;
}

export class Backoff {
  private current: number;
  private readonly initial: number;
  private readonly factor: number;
  private readonly max: number;
  private readonly jitter: number;

  constructor(opts: BackoffOptions = {}) {
    this.initial = this.current = opts.initialMs ?? 1_000;
    this.factor = opts.factor ?? 2;
    this.max = opts.maxMs ?? 60_000;
    this.jitter = opts.jitterRatio ?? 0.25;
  }

  /** Current delay (±jitter), then grow the base for the next call. */
  next(): number {
    const base = this.current;
    this.current = Math.min(this.current * this.factor, this.max);
    if (this.jitter === 0) return base;
    const spread = base * this.jitter;
    return Math.round(base - spread + Math.random() * spread * 2);
  }

  reset(): void {
    this.current = this.initial;
  }
}
