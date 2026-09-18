import { describe, it, expect, afterEach, vi } from "vitest";
import { GithubImporter } from "../src/importer.js";
import { mockFetch } from "./fetch-mock.js";

// spec 013 US3: the credential test action dry-runs GitHub auth with a
// minimal authenticated request (rate_limit — cheap, always available).
describe("GithubImporter.testSecrets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok:true when the token authenticates", async () => {
    mockFetch([{ path: "/rate_limit", body: { resources: {}, rate: {} } }]);
    const res = await new GithubImporter().testSecrets({ token: "ghp_valid" });
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it("returns ok:false on 401 and never leaks the token", async () => {
    mockFetch([
      { path: "/rate_limit", status: 401, body: { message: "Bad credentials" } },
    ]);
    const res = await new GithubImporter().testSecrets({ token: "ghp_secret_value" });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(JSON.stringify(res)).not.toContain("ghp_secret_value");
  });
});
