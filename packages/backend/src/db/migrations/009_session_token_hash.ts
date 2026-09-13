import type { Kysely } from "kysely";
import { sql } from "kysely";

// Migrations are executed against an untyped Kysely instance (see 004).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKysely = Kysely<any>;

/**
 * Migration 009 — stop storing session bearer tokens in plaintext.
 *
 * `sessions.id` historically held the bearer token itself. From this
 * migration on, the application stores SHA-256(token) in `id` and the last
 * 4 characters in `tokenLast4` for display. Existing rows still contain
 * live plaintext tokens that cannot be converted to hashes (the digest is
 * computed by the application, not the database), so every active session
 * is revoked here — users must sign in again once after upgrade.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("sessions")
    .addColumn("tokenLast4", "char(4)")
    .execute();

  await (db as AnyKysely)
    .updateTable("sessions")
    .set({ tokenLast4: sql`right(id, 4)` })
    .execute();

  // Revoke all live sessions: their `id` still holds a plaintext bearer
  // token which is no longer the lookup key format.
  await (db as AnyKysely)
    .updateTable("sessions")
    .set({ revokedAt: sql`now()` })
    .where("revokedAt", "is", null)
    .execute();

  await db.schema
    .alterTable("sessions")
    .alterColumn("tokenLast4", (col) => col.setNotNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("sessions")
    .dropColumn("tokenLast4")
    .execute();
}
