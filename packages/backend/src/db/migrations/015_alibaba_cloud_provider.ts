import type { Kysely } from "kysely";
import { sql } from "kysely";
import { COMPONENT_PROVIDERS } from "@componode/core";

/**
 * Migration 015 — add ALIBABA_CLOUD to the component provider taxonomy.
 *
 * The components_provider_check constraint is rebuilt from the extended
 * COMPONENT_PROVIDERS list (constitution III three-way taxonomy update;
 * spec 024, ADR-115). Down-migration restores the pre-ALIBABA_CLOUD list;
 * it fails safely if ALIBABA_CLOUD rows still exist.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("components")
    .dropConstraint("components_provider_check")
    .execute();

  const providerCheck = sql`provider IN (${sql.join(
    COMPONENT_PROVIDERS.map((p: string) => sql.lit(p)),
  )})`;

  await db.schema
    .alterTable("components")
    .addCheckConstraint("components_provider_check", providerCheck)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("components")
    .dropConstraint("components_provider_check")
    .execute();

  const previousProviders = COMPONENT_PROVIDERS.filter(
    (p: string) => p !== "ALIBABA_CLOUD",
  );
  const providerCheck = sql`provider IN (${sql.join(
    previousProviders.map((p: string) => sql.lit(p)),
  )})`;

  await db.schema
    .alterTable("components")
    .addCheckConstraint("components_provider_check", providerCheck)
    .execute();
}
