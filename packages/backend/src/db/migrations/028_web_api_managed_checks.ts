import type { Kysely } from "kysely";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

/**
 * Migration 028 — Web/API importer collections and managed URL Checks
 * (spec 058, ADR-126 / ADR-077 A5).
 *
 * Schema:
 * - `url_checks.managedKey`: stable check identity from the ImporterConfig
 *   scope; NULL denotes a legacy/manual row.
 * - `source_url_check_memberships`: typed Source→URL Check ownership — which
 *   Source declares which managed check, its reconciliation activity, and
 *   that Source's configured enabled intent.
 *
 * Data migration (one-to-one per old config, idempotent):
 * - Each `{ url }` scope becomes a v2 collection with one Component profile
 *   and one ComponentInstance. The bound ImporterSource's UUID seeds
 *   `sourceKey` and its `externalIdentity` is rekeyed to
 *   `collection:<sourceKey>` — Source ID, memberships, and run history are
 *   preserved.
 * - `componentKey`/`instanceKey` seed from the existing external IDs, so
 *   Components, instances, and slugs survive.
 * - The unique URL Check whose URL equals the instance URL is adopted as
 *   managed (same ID, same observations). Every other existing check —
 *   all of which are manually authored — is disabled and retained.
 */
export async function up(db: AnyDb): Promise<void> {
  await db.schema
    .alterTable("url_checks")
    .addColumn("managedKey", "text")
    .execute();

  // One managed check per imported ComponentInstance.
  await db.schema
    .createIndex("url_checks_managed_key_idx")
    .unique()
    .on("url_checks")
    .columns(["componentInstanceId", "managedKey"])
    .where(sql<boolean>`"managedKey" IS NOT NULL`)
    .execute();

  await db.schema
    .createTable("source_url_check_memberships")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("sourceId", "uuid", (col) =>
      col.notNull().references("importer_sources.id").onDelete("cascade"),
    )
    .addColumn("urlCheckId", "uuid", (col) =>
      col.notNull().references("url_checks.id").onDelete("cascade"),
    )
    .addColumn("checkKey", "text", (col) => col.notNull())
    .addColumn("active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("configuredEnabled", "boolean", (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn("firstSeenInRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("lastSeenInRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("source_url_check_memberships_source_key_uq")
    .unique()
    .on("source_url_check_memberships")
    .columns(["sourceId", "checkKey"])
    .execute();
  await db.schema
    .createIndex("source_url_check_memberships_check_idx")
    .on("source_url_check_memberships")
    .column("urlCheckId")
    .execute();

  const configs = await db
    .selectFrom("importer_configs")
    .select(["id", "label", "scope", "importerName"])
    .where("importerName", "in", ["web-url", "api-url"])
    .execute();

  for (const config of configs) {
    const scope = config.scope as Record<string, unknown> | null;
    // Idempotent: a v2 scope carries sourceKey and is skipped.
    if (!scope || typeof scope.url !== "string" || scope.sourceKey) continue;
    const legacyUrl = scope.url;

    const source = await db
      .selectFrom("importer_sources")
      .select(["id", "lastSeenInRunId"])
      .where("boundConfigId", "=", config.id as string)
      .executeTakeFirst();

    // The existing Source UUID seeds the collection key; its external
    // identity is rekeyed — same row, same memberships, same run history.
    const sourceKey = source?.id ?? uuidv7();
    if (source) {
      await db
        .updateTable("importer_sources")
        .set({ externalIdentity: `collection:${sourceKey}` })
        .where("id", "=", source.id)
        .execute();
    }

    // Resolve the existing Component / ComponentInstance for this config's
    // URL through the bound Source's memberships (best-effort: pick the
    // membership whose instance URL matches).
    let componentKey = uuidv7();
    let instanceKey = uuidv7();
    let matchedInstanceId: string | null = null;
    let instanceEnvironment = "PRODUCTION";
    let instanceRegion: string | null = null;
    let instanceVersion: string | null = null;
    let adoptedEnabled = true;
    let adoptedDef: {
      name: string;
      method: string;
      successPolicy: unknown;
      cadenceSeconds: number | null;
      authMode: string;
      credentialId: string | null;
      authConfig: unknown;
      availabilityTarget: string | null;
      targetWindow: string | null;
      autoDisableAfter: number | null;
    } | null = null;
    let profileName = hostLabel(legacyUrl);
    if (source) {
      const membership = await db
        .selectFrom("source_instance_memberships")
        .innerJoin(
          "component_instances",
          "component_instances.id",
          "source_instance_memberships.componentInstanceId",
        )
        .innerJoin(
          "components",
          "components.id",
          "component_instances.componentId",
        )
        .select([
          "component_instances.id as instanceId",
          "component_instances.externalId as instanceExternalId",
          "component_instances.environment as instanceEnvironment",
          "component_instances.region as instanceRegion",
          "component_instances.version as instanceVersion",
          "components.externalId as componentExternalId",
          "components.name as componentName",
        ])
        .where("source_instance_memberships.sourceId", "=", source.id)
        .where("component_instances.url", "=", legacyUrl)
        .executeTakeFirst();
      if (membership) {
        matchedInstanceId = membership.instanceId;
        instanceKey = membership.instanceExternalId ?? uuidv7();
        componentKey = membership.componentExternalId ?? uuidv7();
        instanceEnvironment = membership.instanceEnvironment ?? "PRODUCTION";
        instanceRegion = membership.instanceRegion ?? null;
        instanceVersion = membership.instanceVersion ?? null;
        // The old name was the raw URL — suggest the URL host instead.
        profileName =
          membership.componentName === legacyUrl
            ? hostLabel(legacyUrl)
            : membership.componentName;
      }
    }

    // Adopt the unique existing URL Check on that instance whose URL equals
    // the instance URL — same row ID, same observation history.
    const checkKey = uuidv7();
    if (matchedInstanceId) {
      const matches = await db
        .selectFrom("url_checks")
        .select([
          "id",
          "enabled",
          "name",
          "method",
          "successPolicy",
          "cadenceSeconds",
          "authMode",
          "credentialId",
          "authConfig",
          "availabilityTarget",
          "targetWindow",
          "autoDisableAfter",
        ])
        .where("componentInstanceId", "=", matchedInstanceId)
        .where("url", "=", legacyUrl)
        .execute();
      if (matches.length === 1) {
        const adoptedCheckId = matches[0]!.id;
        adoptedEnabled = matches[0]!.enabled;
        adoptedDef = matches[0]!;
        // Adoption preserves the check's own enabled state — the config
        // scope's `enabled` mirrors it below.
        await db
          .updateTable("url_checks")
          .set({ managedKey: checkKey })
          .where("id", "=", adoptedCheckId)
          .execute();
        if (source) {
          await db
            .insertInto("source_url_check_memberships")
            .values({
              id: uuidv7(),
              sourceId: source.id,
              urlCheckId: adoptedCheckId,
              checkKey,
              active: true,
              configuredEnabled: adoptedEnabled,
              firstSeenInRunId: source.lastSeenInRunId,
              lastSeenInRunId: source.lastSeenInRunId,
            })
            .execute();
        }
      }
    }

    const migrated = {
      sourceKey,
      components: [
        {
          componentKey,
          name: profileName,
          instances: [
            {
              instanceKey,
              environment: instanceEnvironment,
              ...(instanceRegion ? { region: instanceRegion } : {}),
              ...(instanceVersion ? { version: instanceVersion } : {}),
              url: legacyUrl,
              check: {
                checkKey,
                name: adoptedDef?.name ?? `${profileName} availability`,
                method: adoptedDef?.method ?? "GET",
                enabled: adoptedEnabled,
                successPolicy: adoptedDef?.successPolicy ?? {
                  codes: [],
                  ranges: [{ min: 200, max: 299 }],
                },
                // api-url checks may carry auth; web-url checks are forced
                // to NONE by its schema — only mirror auth for api-url.
                authMode:
                  config.importerName === "api-url"
                    ? (adoptedDef?.authMode ?? "NONE")
                    : "NONE",
                ...(adoptedDef?.cadenceSeconds != null
                  ? { cadenceSeconds: adoptedDef.cadenceSeconds }
                  : {}),
                ...(adoptedDef?.availabilityTarget != null
                  ? { availabilityTarget: Number(adoptedDef.availabilityTarget) }
                  : {}),
                ...(adoptedDef?.targetWindow != null
                  ? { targetWindow: adoptedDef.targetWindow }
                  : {}),
                ...(adoptedDef?.autoDisableAfter != null
                  ? { autoDisableAfter: adoptedDef.autoDisableAfter }
                  : {}),
                ...(config.importerName === "api-url" &&
                adoptedDef?.authMode !== "NONE" &&
                adoptedDef?.credentialId
                  ? { credentialId: adoptedDef.credentialId }
                  : {}),
                ...(config.importerName === "api-url" &&
                adoptedDef?.authMode !== "NONE" &&
                adoptedDef?.authConfig
                  ? { authConfig: adoptedDef.authConfig }
                  : {}),
              },
            },
          ],
        },
      ],
    };
    await db
      .updateTable("importer_configs")
      .set({ scope: JSON.stringify(migrated) })
      .where("id", "=", config.id as string)
      .execute();
  }

  // Legacy manual checks are disabled and retained read-only — adopted
  // managed rows (managedKey set above) are the only checks still running.
  await db
    .updateTable("url_checks")
    .set({ enabled: false, nextProbeAt: null })
    .where("managedKey", "is", null)
    .execute();
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 200);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("source_url_check_memberships").execute();
  await db.schema.dropIndex("url_checks_managed_key_idx").execute();
  await db.schema.alterTable("url_checks").dropColumn("managedKey").execute();
}
