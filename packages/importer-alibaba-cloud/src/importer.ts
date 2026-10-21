import {
  validateDiscoveredAsset,
  type CredentialTestResult,
  type DiscoveredAsset,
  type Importer,
  type ImporterContext,
} from "@componode/core";
import { alibabaCloudConfigSchema, type AlibabaCloudConfig } from "./config.js";
import { buildClients } from "./client.js";
import { buildAccountAsset, type CoverageSummary } from "./account.js";
import { iterResourceAssets, type SearchCoverage } from "./resources.js";
import { fetchCostMap, defaultBillingPeriod, type ResourceBilling } from "./costs.js";
import {
  capabilityMarker,
  warnIfDegraded,
  withCapability,
  type CapabilityMap,
} from "./capabilities.js";

const ENABLED_STATUSES = new Set(["enabled", "activated", "active", "opened"]);

export class AlibabaCloudImporter implements Importer {
  readonly name = "alibaba-cloud";
  readonly version = "1.0.0";

  async *run(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
    context: ImporterContext,
  ): AsyncGenerator<DiscoveredAsset> {
    if (context.signal.aborted) return;

    context.reportPhase("Authenticating");
    const parsed = alibabaCloudConfigSchema.parse(config);
    const client = buildClients(secrets, parsed);

    const identity = await client.getCallerIdentity();
    // Without an AccountId the account asset's externalId would be the
    // collision-prone "unknown" — fail rather than emit a bogus component.
    if (!identity.accountId) {
      throw new Error("Alibaba Cloud GetCallerIdentity returned no AccountId");
    }

    context.reportPhase("Checking service");
    const status = await client.getServiceStatus();
    const serviceStatus = String(status.serviceStatus ?? "").toLowerCase();
    // Fail closed: an absent or unrecognized status means we could not verify
    // Resource Center is enabled — the run must not proceed on a guess.
    if (!ENABLED_STATUSES.has(serviceStatus)) {
      throw new Error(
        `Alibaba Cloud Resource Center is not enabled for this account (serviceStatus: ${status.serviceStatus ?? "unknown"}). ` +
          `Enable Resource Center in the Alibaba Cloud console, then retry the import.`,
      );
    }

    const capabilities: CapabilityMap = {};

    context.reportPhase("Counting resources");
    const counts = await withCapability(() => client.getResourceCounts("ResourceType"));
    capabilities.resourceCounts = capabilityMarker(counts);
    warnIfDegraded(context.logger, "resourceCounts", capabilities.resourceCounts);
    const totals =
      counts.status === "OK"
        ? Object.fromEntries(
            counts.data
              .filter((c) => c.groupName)
              .map((c) => [c.groupName!, c.count ?? 0]),
          )
        : undefined;

    let billing: Map<string, ResourceBilling> | undefined;
    if (parsed.includeCosts) {
      context.reportPhase("Fetching costs");
      const period = parsed.billingPeriod ?? defaultBillingPeriod();
      const costs = await withCapability(() =>
        fetchCostMap(client, period, context.signal),
      );
      capabilities.costs = capabilityMarker(costs);
      warnIfDegraded(context.logger, "costs", capabilities.costs);
      if (costs.status === "OK") billing = costs.data;
    }

    const coverage: SearchCoverage = {
      discoveredCount: 0,
      mappedCount: 0,
      skippedCount: 0,
      skippedTypes: new Set(),
      skippedReasons: { deleted: 0, incomplete: 0, unmappedType: 0 },
    };

    context.reportPhase("Searching resources");
    for await (const asset of iterResourceAssets(client, parsed, context, billing, coverage)) {
      if (context.signal.aborted) return;
      const candidate: unknown = asset;
      if (!validateDiscoveredAsset(candidate)) {
        throw new Error(
          `Invalid discovered asset for resource ${asset.externalId} (${asset.resourceType})`,
        );
      }
      yield candidate;
    }

    if (context.signal.aborted) return;

    const summary: CoverageSummary = {
      discoveredCount: coverage.discoveredCount,
      mappedCount: coverage.mappedCount,
      skippedCount: coverage.skippedCount,
      skippedTypes: [...coverage.skippedTypes].sort(),
      skippedReasons: coverage.skippedReasons,
      ...(totals ? { totals } : {}),
    };

    const accountAsset = buildAccountAsset(identity, parsed, capabilities, summary);
    if (!validateDiscoveredAsset(accountAsset)) {
      throw new Error("Invalid discovered asset for Alibaba Cloud account");
    }
    yield accountAsset;

    context.reportPhase("Completed");
  }

  // Credential test: GetCallerIdentity is the smallest authenticated call and
  // requires no RAM authorization. Error text is code-class only — never
  // echoes credential material.
  async testSecrets(
    secrets: Record<string, string>,
    config?: Record<string, unknown>,
  ): Promise<CredentialTestResult> {
    try {
      const parsed = alibabaCloudConfigSchema.partial().parse(config ?? {});
      const client = buildClients(secrets, parsed as AlibabaCloudConfig);
      await client.getCallerIdentity();
      return { ok: true };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const rawMessage = err instanceof Error ? err.message : "";
      const sanitized = Object.values(secrets)
        .filter(Boolean)
        .reduce((m, s) => m.split(s).join("[redacted]"), rawMessage)
        .slice(0, 200);
      const detail = code ? ` (${String(code)})` : sanitized ? `: ${sanitized}` : "";
      return {
        ok: false,
        error: /invalid|forbidden|denied|unauthorized/i.test(String(code ?? ""))
          ? `Authentication failed (${String(code)})`
          : `Alibaba Cloud request failed${detail}`,
      };
    }
  }
}
