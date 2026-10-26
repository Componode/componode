import { Kysely } from "kysely";

/**
 * Migration 020 — session visibility metadata (spec 032, gap G2).
 *
 * `sessions."userAgent"` and `sessions."ip"` capture the client
 * user-agent header and remote address at session creation so list
 * surfaces can render per-session device and location columns. Both
 * nullable: sessions minted before this migration (or by paths that
 * cannot observe a request context) carry NULL, which read surfaces
 * translate to null metadata rather than fabricated values. `ip` is not
 * a secret-bearing credential — the token hash stays the only sensitive
 * column (ADR-099).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("sessions")
    .addColumn("userAgent", "text")
    .addColumn("ip", "text")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("sessions")
    .dropColumn("userAgent")
    .dropColumn("ip")
    .execute();
}
