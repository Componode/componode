import { sql, type Kysely, type Transaction } from "kysely";
import { uuidv7 } from "uuidv7";
import { db } from "../db/connection.js";
import type { DB } from "../db/types.js";
import {
  normalizePurlIdentity,
  parsePurl,
  mapEcosystemToProvider,
  mapCdxTypeToCategory,
  mappingNote,
  type AddToCatalogPreview,
  type CurationResult,
  type ComponentCategory,
  type ComponentProvider,
  type ComponentProviderGroup,
  COMPONENT_PROVIDER_GROUPS,
  type BomSuggestionReason,
  BOM_SUGGESTION_REASON_META,
} from "@componode/core";
import {
  findComponentByPackageIdentity,
  allocateLibrarySlug,
  stageBomSuggestions,
  acceptBomSuggestions,
  findPendingSuggestionId,
  supersedeBomPairs,
} from "./bom-suggestion-store.js";
import { slugify } from "../utils/slug.js";
import { writeEntityChange, writeEdgeChange, type Actor } from "./audit-service.js";

// Spec 075 / ADR-132 — Phase-2 curation writes. One Library component per
// normalized version-free purl (dedupe across all providers/categories is
// service-layer — `components.externalId` has no DB unique constraint).
// linkConsumers=true wires `component_depends_on_component` edges
// atomically with the resolution; linkConsumers=false stages PENDING
// suggestions instead — never both, never neither (UX-ADD-05).

type DbOrTrx = Kysely<DB> | Transaction<DB>;

const notFound = (entity: string) =>
  Object.assign(new Error(`${entity} not found`), {
    statusCode: 404,
    code: "NOT_FOUND",
  });

function providerGroupOf(provider: ComponentProvider): ComponentProviderGroup {
  return (COMPONENT_PROVIDER_GROUPS["package-registries"] as readonly string[]).includes(
    provider,
  )
    ? "package-registries"
    : "platforms";
}

interface IdentityFacts {
  identity: string;
  name: string;
  purlType: string;
  ecosystem: string;
  cdxType: string | null;
  consumerCount: number;
  versions: { version: string; componentCount: number }[];
}

/** Shared identity aggregate over ACTIVE consumers only (D5). */
async function identityFacts(
  purl: string,
  trx: DbOrTrx,
): Promise<IdentityFacts | null> {
  const identity = normalizePurlIdentity(purl) ?? purl;

  const repQuery = (activeOnly: boolean) => {
    let q = trx
      .selectFrom("bom_entries")
      .innerJoin("components", (join) =>
        join.onRef("components.id", "=", "bom_entries.componentId"),
      )
      .select([
        "bom_entries.name",
        "bom_entries.ecosystem",
        "bom_entries.cdxType",
      ])
      .where("bom_entries.purlIdentity", "=", identity)
      .orderBy("bom_entries.lastReportedAt", "desc")
      .limit(1);
    if (activeOnly) q = q.where("components.lifecycle", "=", "ACTIVE");
    return q.executeTakeFirst();
  };
  // Zero-ACTIVE-consumer identities still preview ("Used by 0") — only a
  // truly unknown identity 404s (spec Edge Cases).
  const rep = (await repQuery(true)) ?? (await repQuery(false));
  if (!rep) return null;

  const consumers = await trx
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join
        .onRef("components.id", "=", "bom_entries.componentId")
        .on("components.lifecycle", "=", "ACTIVE"),
    )
    .select((eb) => eb.fn.count("bom_entries.componentId").distinct().as("n"))
    .where("bom_entries.purlIdentity", "=", identity)
    .executeTakeFirstOrThrow();

  const versionRows = await trx
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join
        .onRef("components.id", "=", "bom_entries.componentId")
        .on("components.lifecycle", "=", "ACTIVE"),
    )
    .select((eb) => [
      "bom_entries.version",
      eb.fn.count("bom_entries.componentId").distinct().as("componentCount"),
    ])
    .where("bom_entries.purlIdentity", "=", identity)
    .where("bom_entries.version", "is not", null)
    .groupBy("bom_entries.version")
    .execute();

  const parsed = parsePurl(purl);
  return {
    identity,
    name: rep.name,
    purlType: parsed?.type ?? rep.ecosystem ?? "generic",
    ecosystem: rep.ecosystem,
    cdxType: rep.cdxType,
    consumerCount: Number(consumers.n),
    versions: versionRows
      .map((r) => ({
        version: r.version!,
        componentCount: Number(r.componentCount),
      }))
      .sort(
        (a, b) =>
          b.componentCount - a.componentCount ||
          a.version.localeCompare(b.version),
      ),
  };
}

/** GET /packages/add-to-catalog/preview. */
export async function previewAddToCatalog(
  purl: string,
): Promise<AddToCatalogPreview> {
  const facts = await identityFacts(purl, db);
  if (!facts) throw notFound("Package");

  const provider = mapEcosystemToProvider(
    facts.ecosystem,
    purl,
  ) as ComponentProvider;
  // includeRetired — the preview must surface a RETIRED identity owner as
  // Link mode (the POST then 409s with a clear retired-target error),
  // never as a create form that 409s on submit (review round 3).
  const existing = await findComponentByPackageIdentity(facts.identity, db, {
    includeRetired: true,
  });

  return {
    name: facts.name,
    identity: facts.identity,
    category: mapCdxTypeToCategory(facts.cdxType) as ComponentCategory,
    provider,
    providerGroup: providerGroupOf(provider),
    resourceType: `${facts.purlType}:package`,
    consumerCount: facts.consumerCount,
    versions: facts.versions,
    mappedFrom: mappingNote(facts.cdxType, facts.ecosystem),
    existingComponent: existing
      ? {
          id: existing.id,
          slug: existing.slug,
          name: existing.name,
          category: existing.category as ComponentCategory,
          provider: existing.provider as ComponentProvider,
        }
      : null,
  };
}

/** Distinct ACTIVE consumers + one representative entry id each. */
async function consumerPairs(
  trx: DbOrTrx,
  identity: string,
): Promise<{ componentId: string; bomEntryId: string }[]> {
  const rows = await trx
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join
        .onRef("components.id", "=", "bom_entries.componentId")
        .on("components.lifecycle", "=", "ACTIVE"),
    )
    .select([
      "bom_entries.componentId",
      sql<string>`(array_agg(bom_entries.id ORDER BY bom_entries."lastReportedAt" DESC))[1]`.as(
        "bomEntryId",
      ),
    ])
    .where("bom_entries.purlIdentity", "=", identity)
    .groupBy("bom_entries.componentId")
    .execute();
  return rows.map((r) => ({
    componentId: r.componentId,
    bomEntryId: r.bomEntryId,
  }));
}

/**
 * Shared resolution+wire/stage tail of both curation endpoints — runs
 * inside the caller's transaction: mark every entry of the identity
 * resolved to `componentId`, then either wire edges + audit them
 * (linkConsumers) or stage PURL_EXACT suggestions.
 */
async function resolveAndWire(
  trx: DbOrTrx,
  identity: string,
  componentId: string,
  linkConsumers: boolean,
  actor: Actor,
  stagedReason: BomSuggestionReason | null = "PURL_EXACT",
): Promise<{ linked: number; alreadyLinked: number; suggestionsStaged: number }> {
  await trx
    .updateTable("bom_entries")
    .set({ resolvedComponentId: componentId, updatedAt: new Date().toISOString() })
    .where("purlIdentity", "=", identity)
    .where((eb) =>
      eb.or([
        eb("resolvedComponentId", "is", null),
        eb("resolvedComponentId", "!=", componentId),
      ]),
    )
    .execute();

  // Never self-wire/self-stage — a self-consuming target is skipped like
  // the match pass does (FR-004 edge case).
  const consumers = (await consumerPairs(trx, identity)).filter(
    (c) => c.componentId !== componentId,
  );
  if (!linkConsumers) {
    // stagedReason is caller-classified (T092) — a null reason means the
    // target has no package-level signal, so no suggestions are staged.
    if (!stagedReason) {
      return { linked: 0, alreadyLinked: 0, suggestionsStaged: 0 };
    }
    // Already-wired pairs land SUPERSEDED tombstones, never actionable
    // PENDING rows — match-pass parity (T103).
    const edgedRows = await trx
      .selectFrom("component_depends_on_component")
      .select(["parentId", "childId"])
      .where("childId", "=", componentId)
      .where(
        "parentId",
        "in",
        consumers.map((c) => c.componentId),
      )
      .execute();
    const edged = new Set(edgedRows.map((e) => `${e.parentId}|${e.childId}`));
    const covered = consumers.filter((c) =>
      edged.has(`${c.componentId}|${componentId}`),
    );
    const stageable = consumers.filter(
      (c) => !edged.has(`${c.componentId}|${componentId}`),
    );
    await supersedeBomPairs(
      trx,
      covered.map((c) => ({
        parentComponentId: c.componentId,
        childComponentId: componentId,
        bomEntryId: c.bomEntryId,
      })),
      actor,
    );
    const suggestionsStaged = await stageBomSuggestions(
      stageable.map((c) => ({
        bomEntryId: c.bomEntryId,
        parentComponentId: c.componentId,
        childComponentId: componentId,
        reason: stagedReason,
        score: BOM_SUGGESTION_REASON_META[stagedReason].score,
      })),
      trx,
    );
    return { linked: 0, alreadyLinked: 0, suggestionsStaged };
  }

  let linked = 0;
  let alreadyLinked = 0;
  for (const consumer of consumers) {
    const res = await trx
      .insertInto("component_depends_on_component")
      .values({
        parentId: consumer.componentId,
        childId: componentId,
        createdAt: new Date().toISOString(),
      })
      .onConflict((oc) => oc.columns(["parentId", "childId"]).doNothing())
      .executeTakeFirst();
    const inserted = Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
    if (inserted) {
      linked++;
      await writeEdgeChange(
        "component_depends_on_component",
        { entityType: "component", entityId: consumer.componentId },
        { entityType: "component", entityId: componentId },
        "added",
        actor,
        "bom-curation:link-consumers",
        trx,
      );
      // Link-all is itself the human's decide — a covered PENDING row
      // lands ACCEPTED (data-model state machine).
      const pendingId = await findPendingSuggestionId(
        trx,
        consumer.componentId,
        componentId,
      );
      if (pendingId) {
        await acceptBomSuggestions(trx, [pendingId], actor);
      }
    } else {
      alreadyLinked++;
      // Already-wired pairs land SUPERSEDED — decideOne parity: the human
      // didn't just wire this pair, the pair was already covered (T078).
      await trx
        .updateTable("bom_component_suggestions")
        .set({
          status: "SUPERSEDED",
          reason: null,
          score: null,
          decidedAt: new Date().toISOString(),
          decidedBy: actor.id,
        })
        .where("parentComponentId", "=", consumer.componentId)
        .where("childComponentId", "=", componentId)
        .where("status", "=", "PENDING")
        .execute();
    }
  }
  return { linked, alreadyLinked, suggestionsStaged: 0 };
}

/** POST /packages/add-to-catalog — create one Library per identity. */
export async function addPackageToCatalog(
  input: { purl: string; linkConsumers: boolean },
  actor: Actor,
): Promise<CurationResult> {
  const facts = await identityFacts(input.purl, db);
  if (!facts) throw notFound("Package");

  const existing = await findComponentByPackageIdentity(facts.identity, db, {
    includeRetired: true,
  });
  if (existing) {
    throw Object.assign(
      new Error("A component already covers this package identity"),
      {
        statusCode: 409,
        code: "CONFLICT",
        details: { existingComponent: existing },
      },
    );
  }

  const category = mapCdxTypeToCategory(facts.cdxType);
  const provider = mapEcosystemToProvider(facts.ecosystem, input.purl);
  const now = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    // Serialize on the identity — externalId has no unique index by
    // design, so a concurrent add could mint a duplicate Library between
    // the outer check and this insert (FR-005, T091).
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${facts.identity}, 0))`.execute(
      trx,
    );
    const insideTrx = await findComponentByPackageIdentity(
      facts.identity,
      trx,
      { includeRetired: true },
    );
    if (insideTrx) {
      throw Object.assign(
        new Error("A component already covers this package identity"),
        {
          statusCode: 409,
          code: "CONFLICT",
          details: { existingComponent: insideTrx },
        },
      );
    }

    const id = uuidv7();
    const slug = await allocateLibrarySlug(facts.purlType, facts.name, trx);
    await trx
      .insertInto("components")
      .values({
        id,
        name: facts.name,
        slug,
        category,
        provider,
        resourceType: `${facts.purlType}:package`,
        lifecycle: "ACTIVE",
        teamOwnerId: null,
        externalId: facts.identity,
        details: null,
        links: [],
        tags: [],
        sunsetAt: null,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: actor.id,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await writeEntityChange(
      {
        entityType: "component",
        entityId: id,
        action: "created",
        changes: {
          name: facts.name,
          slug,
          category,
          provider,
          resourceType: `${facts.purlType}:package`,
          externalId: facts.identity,
          provenance: "bom-add-to-catalog",
        },
        actor,
      },
      trx,
    );

    const outcome = await resolveAndWire(
      trx,
      facts.identity,
      id,
      input.linkConsumers,
      actor,
    );

    return {
      component: {
        id,
        slug,
        name: facts.name,
        category: category as ComponentCategory,
        provider: provider as ComponentProvider,
        externalId: facts.identity,
      },
      ...outcome,
    };
  });
}

/** POST /packages/link — resolve an identity onto a chosen component. */
export async function linkPackageToComponent(
  input: { purl: string; componentId: string; linkConsumers: boolean },
  actor: Actor,
): Promise<CurationResult> {
  const facts = await identityFacts(input.purl, db);
  if (!facts) throw notFound("Package");

  const target = await db
    .selectFrom("components")
    .select([
      "id",
      "slug",
      "name",
      "category",
      "provider",
      "externalId",
      "lifecycle",
    ])
    .where("id", "=", input.componentId)
    .executeTakeFirst();
  if (!target) throw notFound("Component");
  if (target.lifecycle === "RETIRED") {
    throw Object.assign(new Error("Cannot link a package to a retired component"), {
      statusCode: 409,
      code: "CONFLICT",
    });
  }

  // Classify the staged-suggestion reason honestly (T092): the target may
  // not be an exact identity match — the user's link is itself evidence,
  // but PURL_EXACT must reflect an actual normalized-identity match so
  // linked non-exact pairs can't slip past the exact-only bulk gate.
  const targetIdentity =
    target.externalId && target.externalId.toLowerCase().startsWith("pkg:")
      ? normalizePurlIdentity(target.externalId)
      : null;
  const stagedReason: BomSuggestionReason | null =
    target.externalId === facts.identity || targetIdentity === facts.identity
      ? "PURL_EXACT"
      : target.name.trim().toLowerCase() === facts.name.trim().toLowerCase()
        ? "PURL_NAME_MATCH"
        : target.slug === slugify(facts.name)
          ? "CATALOG_SLUG_MATCH"
          : null;

  return db.transaction().execute(async (trx) => {
    // Re-check the lifecycle inside the transaction — the target could
    // have retired since the outer read (T102).
    const locked = await trx
      .selectFrom("components")
      .select("lifecycle")
      .where("id", "=", target.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (locked.lifecycle === "RETIRED") {
      throw Object.assign(
        new Error("Cannot link a package to a retired component"),
        { statusCode: 409, code: "CONFLICT" },
      );
    }

    const outcome = await resolveAndWire(
      trx,
      facts.identity,
      target.id,
      input.linkConsumers,
      actor,
      stagedReason,
    );
    return {
      component: {
        id: target.id,
        slug: target.slug,
        name: target.name,
        category: target.category as ComponentCategory,
        provider: target.provider as ComponentProvider,
        externalId: target.externalId,
      },
      ...outcome,
    };
  });
}
