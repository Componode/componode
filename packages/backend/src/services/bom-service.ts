import type { Kysely } from "kysely";
import { uuidv7 } from "uuidv7";
import type { DB } from "../db/types.js";
import type { DiscoveredBomEntry } from "@componode/core";
import { purlEcosystem } from "@componode/core";

// Spec 073 / ADR-131 — the BOM write path. Entries are factual importer
// observations upserted per-asset during the run and key-matched-replaced
// at run completion, source-scoped. Upsert keys mirror migration 032's two
// partial unique indexes: `(componentId, purl, scope, componentInstanceId)`
// for top-level rows, plus `parentBomEntryId` for children.

export interface BomScope {
  componentId: string;
  componentInstanceId: string | null;
}

export interface BomProcessResult {
  created: number;
  updated: number;
  unchanged: number;
}

interface ProcessBomOptions {
  componentId: string;
  componentInstanceId: string | null;
  sourceId: string | null;
  runId: string;
  entries: DiscoveredBomEntry[];
}

// The mutable payload compared to decide updated-vs-unchanged. Keys and
// identity columns are excluded — they select the row.
function payloadOf(entry: DiscoveredBomEntry, scope: string, direct: boolean) {
  return {
    name: entry.name,
    version: entry.version ?? null,
    ecosystem: purlEcosystem(entry.purl) ?? "unknown",
    scope,
    evidenceSource: entry.evidenceSource,
    evidenceDetail: entry.evidenceDetail ?? null,
    supplier: entry.supplier ?? null,
    licenses: entry.licenses ?? [],
    direct,
    cdxType: entry.cdxType ?? null,
    cdxBomRef: entry.cdxBomRef ?? null,
    details: entry.details ?? null,
  };
}

function samePayload(
  row: Record<string, unknown>,
  payload: ReturnType<typeof payloadOf>,
): boolean {
  return (
    row.name === payload.name &&
    row.version === payload.version &&
    row.ecosystem === payload.ecosystem &&
    row.scope === payload.scope &&
    row.evidenceSource === payload.evidenceSource &&
    row.evidenceDetail === payload.evidenceDetail &&
    row.supplier === payload.supplier &&
    JSON.stringify(row.licenses) === JSON.stringify(payload.licenses) &&
    row.direct === payload.direct &&
    row.cdxType === payload.cdxType &&
    row.cdxBomRef === payload.cdxBomRef &&
    JSON.stringify(row.details) === JSON.stringify(payload.details)
  );
}

/**
 * Upserts the reported BOM tree for one `(componentId, componentInstanceId)`
 * scope inside the per-asset run transaction. Top-down so children bind the
 * freshly upserted parent id. `direct` defaults to `scope !== 'TRANSITIVE'`;
 * an explicit `direct` always wins (authoritative, ADR-131).
 */
export async function processBomEntries(
  trx: Kysely<DB>,
  opts: ProcessBomOptions,
): Promise<BomProcessResult> {
  const result: BomProcessResult = { created: 0, updated: 0, unchanged: 0 };
  const now = new Date().toISOString();

  const upsert = async (
    entry: DiscoveredBomEntry,
    parentBomEntryId: string | null,
  ): Promise<string> => {
    const scope = entry.scope ?? "RUNTIME";
    // `direct` is authoritative — only default when absent.
    const direct = entry.direct ?? scope !== "TRANSITIVE";
    const payload = payloadOf(entry, scope, direct);

    let keyQuery = trx
      .selectFrom("bom_entries")
      .selectAll()
      .where("componentId", "=", opts.componentId)
      .where("purl", "=", entry.purl)
      .where("scope", "=", scope);
    keyQuery =
      opts.componentInstanceId === null
        ? keyQuery.where("componentInstanceId", "is", null)
        : keyQuery.where("componentInstanceId", "=", opts.componentInstanceId);
    keyQuery =
      parentBomEntryId === null
        ? keyQuery.where("parentBomEntryId", "is", null)
        : keyQuery.where("parentBomEntryId", "=", parentBomEntryId);
    const existing = await keyQuery.executeTakeFirst();

    const id = existing?.id ?? uuidv7();
    const insert = trx
      .insertInto("bom_entries")
      .values({
        id,
        componentId: opts.componentId,
        componentInstanceId: opts.componentInstanceId,
        parentBomEntryId,
        purl: entry.purl,
        ...payload,
        // pg serializes JS arrays as Postgres array literals, not JSON —
        // stringify so jsonb stores a real array ('[]' → '{}' otherwise).
        licenses: JSON.stringify(payload.licenses),
        lastReportedAt: now,
        importRunId: opts.runId,
        sourceId: opts.sourceId,
        resolvedComponentId: null,
        createdAt: now,
        updatedAt: now,
      });

    const conflictColumns =
      parentBomEntryId === null
        ? (["componentId", "purl", "scope", "componentInstanceId"] as const)
        : ([
            "componentId",
            "purl",
            "scope",
            "componentInstanceId",
            "parentBomEntryId",
          ] as const);

    await insert
      .onConflict((oc) =>
        oc
          .columns([...conflictColumns])
          .where("parentBomEntryId", parentBomEntryId === null ? "is" : "is not", null)
          .doUpdateSet({
            ...payload,
            licenses: JSON.stringify(payload.licenses),
            lastReportedAt: now,
            importRunId: opts.runId,
            sourceId: opts.sourceId,
            updatedAt: now,
          }),
      )
      .execute();

    if (!existing) result.created++;
    else if (samePayload(existing, payload)) result.unchanged++;
    else result.updated++;

    for (const child of entry.children ?? []) {
      await upsert(child, id);
    }
    return id;
  };

  for (const entry of opts.entries) {
    await upsert(entry, null);
  }
  return result;
}

/**
 * Source-scoped diff-replace (ADR-131). Runs only on COMPLETED runs, once per
 * reported `(componentId, componentInstanceId)` scope — including scopes that
 * reported `[]` (present-but-empty clears the set). Deletes the source's rows
 * in those scopes whose `importRunId` is stale. Returns rows removed.
 */
export async function deleteAbsentBomEntries(
  trx: Kysely<DB>,
  scopes: BomScope[],
  sourceId: string | null,
  runId: string,
): Promise<number> {
  let removed = 0;
  for (const scope of scopes) {
    let q = trx
      .deleteFrom("bom_entries")
      .where("componentId", "=", scope.componentId)
      .where((eb) =>
        eb("importRunId", "is", null).or("importRunId", "!=", runId),
      );
    q =
      sourceId === null
        ? q.where("sourceId", "is", null)
        : q.where("sourceId", "=", sourceId);
    q =
      scope.componentInstanceId === null
        ? q.where("componentInstanceId", "is", null)
        : q.where("componentInstanceId", "=", scope.componentInstanceId);
    const res = await q.executeTakeFirst();
    removed += Number(res.numDeletedRows ?? 0);
  }
  return removed;
}
