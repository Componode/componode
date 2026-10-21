import type { AlibabaClients } from "./client.js";

export interface ResourceBilling {
  pretaxAmount: number;
  pretaxGrossAmount: number;
  currency: string | null;
  productName: string | null;
  lineItems: number;
}

// Latest closed billing cycle = previous calendar month (current month is
// still accruing).
export function defaultBillingPeriod(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function fetchCostMap(
  client: AlibabaClients,
  billingCycle: string,
  signal: AbortSignal,
): Promise<Map<string, ResourceBilling>> {
  const costs = new Map<string, ResourceBilling>();
  let nextToken: string | undefined;

  do {
    if (signal.aborted) return costs;
    const page = await client.describeInstanceBillPage({
      billingCycle,
      nextToken,
      maxResults: 300,
    });

    for (const item of page.items) {
      const id = item.instanceID;
      if (!id) continue;
      const existing = costs.get(id) ?? {
        pretaxAmount: 0,
        pretaxGrossAmount: 0,
        currency: item.currency ?? null,
        productName: item.productName ?? null,
        lineItems: 0,
      };
      existing.pretaxAmount += item.pretaxAmount ?? 0;
      existing.pretaxGrossAmount += item.pretaxGrossAmount ?? 0;
      existing.lineItems += 1;
      costs.set(id, existing);
    }

    nextToken = page.nextToken || undefined;
  } while (nextToken);

  return costs;
}
