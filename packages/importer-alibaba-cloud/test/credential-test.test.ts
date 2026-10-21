import { describe, it, expect, vi, beforeEach } from "vitest";
import { AlibabaCloudImporter } from "../src/importer.js";
import { buildClients } from "../src/client.js";
import { makeClients, makeSecrets } from "./client-mock.js";

vi.mock("../src/client.js", () => ({
  buildClients: vi.fn(),
}));

const mockBuildClients = vi.mocked(buildClients);

beforeEach(() => {
  mockBuildClients.mockReset();
});

describe("AlibabaCloudImporter.testSecrets — US2", () => {
  it("returns ok on a successful identity probe", async () => {
    const getCallerIdentity = vi.fn(async () => ({ accountId: "1" }));
    mockBuildClients.mockReturnValue(makeClients({ getCallerIdentity }));

    const result = await new AlibabaCloudImporter().testSecrets(makeSecrets());
    expect(result).toEqual({ ok: true });
    expect(getCallerIdentity).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false with a code-class message on auth failure", async () => {
    mockBuildClients.mockReturnValue(makeClients({
      getCallerIdentity: vi.fn(async () => {
        throw Object.assign(new Error("bad key"), { code: "InvalidAccessKeyId" });
      }),
    }));

    const result = await new AlibabaCloudImporter().testSecrets(makeSecrets());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("InvalidAccessKeyId");
  });

  it("never echoes credential material in error output", async () => {
    mockBuildClients.mockReturnValue(makeClients({
      getCallerIdentity: vi.fn(async () => {
        throw new Error("request failed with SECRETTEST embedded");
      }),
    }));

    const result = await new AlibabaCloudImporter().testSecrets(makeSecrets());
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("SECRETTEST");
    expect(result.error).not.toContain("AKIDTEST");
  });

  it("reports non-auth failures generically", async () => {
    mockBuildClients.mockReturnValue(makeClients({
      getCallerIdentity: vi.fn(async () => {
        throw Object.assign(new Error("timeout"), { code: "ReadTimeout" });
      }),
    }));

    const result = await new AlibabaCloudImporter().testSecrets(makeSecrets());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Alibaba Cloud request failed");
  });
});
