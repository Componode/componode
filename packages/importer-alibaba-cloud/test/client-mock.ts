import { vi } from "vitest";
import type { AlibabaClients, SearchRecord } from "../src/client.js";
import type { ImporterContext } from "@componode/core";
import { NOOP_LOGGER } from "@componode/core";

// NOTE: each test file must register the mock itself — vi.mock is file-scoped:
//   vi.mock("../src/client.js", () => ({ buildClients: vi.fn() }));

export function makeContext(overrides?: Partial<ImporterContext>): ImporterContext {
  return {
    runId: "run-1",
    logger: { ...NOOP_LOGGER, warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
    ...overrides,
  };
}

export function makeSecrets(): Record<string, string> {
  return {
    accessKeyId: "AKIDTEST",
    accessKeySecret: "SECRETTEST",
  };
}

export function makeClients(overrides?: Partial<AlibabaClients>): AlibabaClients {
  return {
    getCallerIdentity: vi.fn(async () => ({
      accountId: "1234567890123456",
      arn: "acs:ram::1234567890123456:user/importer",
      identityType: "RAMUser",
      principalId: "288774244375211234",
    })),
    getServiceStatus: vi.fn(async () => ({ serviceStatus: "Enabled" })),
    getResourceCounts: vi.fn(async () => []),
    searchResourcesPage: vi.fn(async () => ({ resources: [] })),
    getResourceConfiguration: vi.fn(async () => ({})),
    describeInstanceBillPage: vi.fn(async () => ({ items: [] })),
    ...overrides,
  };
}

export function makeSearchRecord(overrides?: Partial<SearchRecord>): SearchRecord {
  return {
    accountId: "1234567890123456",
    createTime: "2026-01-15T08:00:00Z",
    regionId: "cn-hangzhou",
    resourceId: "i-bp1234567890abcdef",
    resourceName: "web-server-01",
    resourceType: "ACS::ECS::Instance",
    tags: [{ key: "env", value: "prod" }],
    zoneId: "cn-hangzhou-i",
    ...overrides,
  };
}
