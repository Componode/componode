import type { Kysely } from "kysely";
import { sql } from "kysely";
import {
  COMPONENT_PROVIDERS,
  COMPONENT_PROVIDER_GROUPS,
} from "@componode/core";

/**
 * Migration 036 — widen the component provider taxonomy for Phase-2
 * catalog promotion (spec 075, ADR-013 Amendment 2).
 *
 * 13 package-registry/container/OS providers join the 11 platforms so
 * curated Library components can carry their ecosystem. The
 * components_provider_check constraint is rebuilt from the extended
 * COMPONENT_PROVIDERS list (same pattern as
 * 015_alibaba_cloud_provider.ts). Down-migration restores the platforms-
 * only CHECK and fails safely if registry-provider rows still exist.
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

  const previousProviders = COMPONENT_PROVIDER_GROUPS.platforms;
  const providerCheck = sql`provider IN (${sql.join(
    previousProviders.map((p: string) => sql.lit(p)),
  )})`;

  await db.schema
    .alterTable("components")
    .addCheckConstraint("components_provider_check", providerCheck)
    .execute();
}
