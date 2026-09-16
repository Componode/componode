import { Octokit } from "octokit";
import type { GithubConfig } from "./config.js";

export function buildOctokit(
  config: GithubConfig,
  secrets: Record<string, string>,
): Octokit {
  return new Octokit({
    auth: secrets.token,
    baseUrl: config.baseUrl,
    request: {
      headers: {
        "X-GitHub-Api-Version": "2026-03-10",
      },
    },
  });
}
