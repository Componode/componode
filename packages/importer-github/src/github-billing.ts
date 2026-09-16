import type { Octokit } from "octokit";
import type { Logger } from "@componode/core";
import { withCapability, warnIfDegraded, type CapabilityStatus } from "./capabilities.js";
import type { GithubConfig } from "./config.js";

export interface ProductUsage {
  product: string;
  sku?: string;
  netAmount: number;
  quantity: number;
  unitType?: string;
}

export interface RepoBilling {
  netAmount: number;
  byProduct: ProductUsage[];
}

export interface SectionedCapability {
  status: CapabilityStatus;
  [key: string]: unknown;
}

export interface BillingSnapshot {
  status: CapabilityStatus;
  message?: string;
  period?: { year: number; month: number };
  totals?: { grossAmount: number; discountAmount: number; netAmount: number };
  byProduct?: ProductUsage[];
  topRepos?: { repository: string; netAmount: number }[];
  actionsMinutes?: SectionedCapability;
  packagesStorage?: SectionedCapability;
  sharedStorage?: SectionedCapability;
  aiCredits?: SectionedCapability;
  premiumRequests?: SectionedCapability;
}

export interface BillingResult {
  billing: BillingSnapshot;
  repoBilling: Map<string, RepoBilling>;
}

interface UsageItem {
  product?: string;
  sku?: string;
  quantity?: number;
  unitType?: string;
  grossAmount?: number;
  discountAmount?: number;
  netAmount?: number;
  repositoryName?: string;
}

const MAX_TOP_REPOS = 25;

function resolvePeriod(period: "current" | "previous"): { year: number; month: number } {
  const now = new Date();
  if (period === "current") {
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }
  return now.getUTCMonth() === 0
    ? { year: now.getUTCFullYear() - 1, month: 12 }
    : { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

function round(amount: number): number {
  return Math.round(amount * 10000) / 10000;
}

function aggregateByProduct(items: UsageItem[]): ProductUsage[] {
  const byProduct = new Map<string, ProductUsage>();
  for (const item of items) {
    const product = item.product ?? "unknown";
    const sku = item.sku;
    const key = `${product}${sku ?? ""}`;
    const entry = byProduct.get(key) ?? {
      product,
      sku,
      netAmount: 0,
      quantity: 0,
      unitType: item.unitType,
    };
    entry.netAmount = round(entry.netAmount + (item.netAmount ?? 0));
    entry.quantity = round(entry.quantity + (item.quantity ?? 0));
    entry.unitType ??= item.unitType;
    byProduct.set(key, entry);
  }
  return [...byProduct.values()].sort((a, b) => b.netAmount - a.netAmount);
}

export async function fetchBillingSnapshot(
  octokit: Octokit,
  org: string,
  period: GithubConfig["billingPeriod"],
  signal: AbortSignal,
  logger: Logger,
): Promise<BillingResult> {
  const { year, month } = resolvePeriod(period);
  const repoBilling = new Map<string, RepoBilling>();

  const usageResult = await withCapability(() =>
    octokit.rest.billing.getGithubBillingUsageReportOrg({ org, year, month, signal }),
  );

  const billing: BillingSnapshot = {
    status: usageResult.status,
    period: { year, month },
  };
  if (usageResult.message) billing.message = usageResult.message;
  warnIfDegraded(logger, "billing", billing);

  if (usageResult.status === "OK" && usageResult.data) {
    const items = ((usageResult.data.data as { usageItems?: UsageItem[] }).usageItems ?? []);

    const totals = { grossAmount: 0, discountAmount: 0, netAmount: 0 };
    for (const item of items) {
      totals.grossAmount += item.grossAmount ?? 0;
      totals.discountAmount += item.discountAmount ?? 0;
      totals.netAmount += item.netAmount ?? 0;
    }
    billing.totals = {
      grossAmount: round(totals.grossAmount),
      discountAmount: round(totals.discountAmount),
      netAmount: round(totals.netAmount),
    };
    billing.byProduct = aggregateByProduct(items);

    const byRepo = new Map<string, UsageItem[]>();
    for (const item of items) {
      if (!item.repositoryName) continue;
      const list = byRepo.get(item.repositoryName) ?? [];
      list.push(item);
      byRepo.set(item.repositoryName, list);
    }

    for (const [repo, repoItems] of byRepo) {
      const byProduct = aggregateByProduct(repoItems);
      repoBilling.set(repo, {
        netAmount: round(repoItems.reduce((sum, i) => sum + (i.netAmount ?? 0), 0)),
        byProduct,
      });
    }

    billing.topRepos = [...repoBilling.entries()]
      .sort((a, b) => b[1].netAmount - a[1].netAmount)
      .slice(0, MAX_TOP_REPOS)
      .map(([repository, r]) => ({ repository, netAmount: r.netAmount }));
  }

  if (signal.aborted) return { billing, repoBilling };

  const actionsResult = await withCapability(() =>
    octokit.rest.billing.getGithubActionsBillingOrg({ org, signal }),
  );
  billing.actionsMinutes =
    actionsResult.status === "OK"
      ? {
          status: "OK",
          includedMinutes: (actionsResult.data.data as { included_minutes?: number }).included_minutes,
          usedMinutes: (actionsResult.data.data as { total_minutes_used?: number }).total_minutes_used,
        }
      : { status: actionsResult.status, message: actionsResult.message };
  warnIfDegraded(logger, "actionsMinutes", billing.actionsMinutes as { status: CapabilityStatus });

  const packagesResult = await withCapability(() =>
    octokit.rest.billing.getGithubPackagesBillingOrg({ org, signal }),
  );
  billing.packagesStorage =
    packagesResult.status === "OK"
      ? {
          status: "OK",
          gigabytesUsed: (packagesResult.data.data as { total_gigabytes_bandwidth_used?: number }).total_gigabytes_bandwidth_used,
          includedGigabytes: (packagesResult.data.data as { included_gigabytes_bandwidth?: number }).included_gigabytes_bandwidth,
        }
      : { status: packagesResult.status, message: packagesResult.message };
  warnIfDegraded(logger, "packagesStorage", billing.packagesStorage as { status: CapabilityStatus });

  const storageResult = await withCapability(() =>
    octokit.rest.billing.getSharedStorageBillingOrg({ org, signal }),
  );
  billing.sharedStorage =
    storageResult.status === "OK"
      ? {
          status: "OK",
          daysLeftInCycle: (storageResult.data.data as { days_left_in_billing_cycle?: number }).days_left_in_billing_cycle,
          estimatedPaidStorage: (storageResult.data.data as { estimated_paid_storage_for_month?: number }).estimated_paid_storage_for_month,
          estimatedStorage: (storageResult.data.data as { estimated_storage_for_month?: number }).estimated_storage_for_month,
        }
      : { status: storageResult.status, message: storageResult.message };
  warnIfDegraded(logger, "sharedStorage", billing.sharedStorage as { status: CapabilityStatus });

  const aiCreditsResult = await withCapability(() =>
    octokit.request("GET /organizations/{org}/settings/billing/ai_credit/usage", {
      org,
      year,
      month,
      signal,
    }),
  );
  billing.aiCredits =
    aiCreditsResult.status === "OK"
      ? {
          status: "OK",
          netAmount: round(
            ((aiCreditsResult.data.data as { usageItems?: UsageItem[] }).usageItems ?? [])
              .reduce((sum, i) => sum + (i.netAmount ?? 0), 0),
          ),
        }
      : { status: aiCreditsResult.status, message: aiCreditsResult.message };
  warnIfDegraded(logger, "aiCredits", billing.aiCredits as { status: CapabilityStatus });

  const premiumResult = await withCapability(() =>
    octokit.request("GET /organizations/{org}/settings/billing/premium_request/usage", {
      org,
      year,
      month,
      signal,
    }),
  );
  billing.premiumRequests =
    premiumResult.status === "OK"
      ? {
          status: "OK",
          netAmount: round(
            ((premiumResult.data.data as { usageItems?: UsageItem[] }).usageItems ?? [])
              .reduce((sum, i) => sum + (i.netAmount ?? 0), 0),
          ),
        }
      : { status: premiumResult.status, message: premiumResult.message };
  warnIfDegraded(logger, "premiumRequests", billing.premiumRequests as { status: CapabilityStatus });

  return { billing, repoBilling };
}
