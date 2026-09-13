import { db } from "../db/connection.js";
import { verifyPassword, hashPassword, verifyAgainstDummyHash } from "../utils/argon2.js";
import { hashToken } from "../utils/crypto.js";
import { metrics } from "../plugins/metrics.js";
import { createSession } from "./session-service.js";
import { writeAuthEvent, type Actor } from "./audit-service.js";

interface AuthenticatedUser {
  id: string;
  username: string;
  role: string;
  displayName: string | null;
}

export async function login(
  username: string,
  password: string,
): Promise<{ user: AuthenticatedUser; sessionToken: string }> {
  const user = await db
    .selectFrom("persons")
    .select([
      "persons.id",
      "persons.username",
      "persons.role",
      "persons.displayName",
      "persons.passwordHash",
      "persons.isActive",
    ])
    .where("persons.username", "=", username)
    .executeTakeFirst();

  if (!user || !user.isActive || !user.passwordHash) {
    // Timing equalization: run the same Argon2 verification work so the
    // missing-user path is not distinguishable from a wrong password.
    await verifyAgainstDummyHash(password);
    metrics.authEventsTotal.inc({ event: "login", outcome: "failure" });
    await writeAuthEvent("login_failed", username, { id: null, name: username });
    throw Object.assign(new Error("Invalid credentials"), { statusCode: 401, code: "AUTH_INVALID_CREDENTIALS" });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    metrics.authEventsTotal.inc({ event: "login", outcome: "failure" });
    await writeAuthEvent("login_failed", username, { id: null, name: username });
    throw Object.assign(new Error("Invalid credentials"), { statusCode: 401, code: "AUTH_INVALID_CREDENTIALS" });
  }

  const sessionToken = await createSession(user.id);

  metrics.authEventsTotal.inc({ event: "login", outcome: "success" });
  await writeAuthEvent("login", null, { id: user.id, name: user.displayName ?? user.username });

  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    },
    sessionToken,
  };
}

export async function logout(sessionToken: string, actor: Actor): Promise<void> {
  const now = new Date().toISOString();
  await db
    .updateTable("sessions")
    .set({ revokedAt: now })
    .where("sessions.id", "=", hashToken(sessionToken))
    .execute();

  metrics.authEventsTotal.inc({ event: "logout", outcome: "success" });
  await writeAuthEvent("logout", null, actor);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  actor: Actor,
): Promise<void> {
  const user = await db
    .selectFrom("persons")
    .select(["id", "passwordHash", "displayName", "username"])
    .where("persons.id", "=", userId)
    .executeTakeFirst();

  if (!user || !user.passwordHash) {
    throw Object.assign(new Error("User not found"), { statusCode: 404, code: "NOT_FOUND" });
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Current password is incorrect"), {
      statusCode: 401,
      code: "AUTH_INVALID_CREDENTIALS",
    });
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();

  await db
    .updateTable("persons")
    .set({ passwordHash, updatedAt: now })
    .where("persons.id", "=", userId)
    .execute();

  await writeAuthEvent("password_change", null, actor);
}
