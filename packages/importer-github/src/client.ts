import { Octokit } from "octokit";
import type { GithubConfig } from "./config.js";

// FR-015: bound rate-limit retries — the octokit defaults retry only once
// (retryCount === 0). Allow up to 3 retries per request; the plugins honor
// Retry-After / X-RateLimit-Reset delays themselves.
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_TRANSIENT_RETRIES = 3;

function rateLimitHandler(kind: "rate" | "secondary") {
  return (
    retryAfter: number,
    options: { method?: string; url?: string },
    octokit: Octokit,
    retryCount: number,
  ) => {
    octokit.log.warn(
      `GitHub ${kind} rate limit hit for ${options.method} ${options.url}`,
    );
    if (retryCount < MAX_RATE_LIMIT_RETRIES) {
      octokit.log.info(`Retrying after ${retryAfter} seconds`);
      return true;
    }
    octokit.log.warn(`Rate-limit retries exhausted for ${options.method} ${options.url}`);
    return false;
  };
}

export function buildOctokit(
  config: GithubConfig,
  secrets: Record<string, string>,
): Octokit {
  return new Octokit({
    auth: secrets.token,
    baseUrl: config.baseUrl,
    retry: {
      retries: MAX_TRANSIENT_RETRIES,
    },
    throttle: {
      onRateLimit: rateLimitHandler("rate"),
      onSecondaryRateLimit: rateLimitHandler("secondary"),
    },
    request: {
      headers: {
        "X-GitHub-Api-Version": "2026-03-10",
      },
    },
  });
}
