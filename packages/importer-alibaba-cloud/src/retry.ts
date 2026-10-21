const MAX_THROTTLE_RETRIES = 3;

export function isThrottling(err: unknown): boolean {
  const code = String(
    (err as { code?: string; name?: string })?.code ??
      (err as { name?: string })?.name ??
      "",
  );
  return /throttl/i.test(code);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

// Retries a throttled call with exponential backoff (max 3). Any other
// error propagates; an abort during backoff resolves early and throws the
// signal's AbortError so a cancelled run isn't recorded as a Throttling
// failure.
export async function withThrottleRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isThrottling(err) && attempt < MAX_THROTTLE_RETRIES && !signal.aborted) {
        await sleep(100 * 2 ** attempt + Math.floor(Math.random() * 100), signal);
        signal.throwIfAborted();
        continue;
      }
      throw err;
    }
  }
}
