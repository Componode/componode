import { z } from "zod";

// Typed docker-targets.json profile schema (ADR-121). The core envelope
// schema is deliberately loose; transport-specific fields are the
// importing importer's contract — validated before ANY network use.
const keyRef = z.string().trim().min(1).max(100);

const socketProfile = z
  .object({
    transport: z.literal("socket"),
    path: z
      .string()
      .min(1)
      .refine(
        (p) => (p.startsWith("/") && !p.includes("..")) || p.startsWith("//./pipe/"),
        { message: "path must be an absolute socket path or //./pipe/ npipe" },
      ),
  })
  .strict();

const tcpProfile = z
  .object({
    transport: z.literal("tcp"),
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(2376),
    // Optional only for public/system-CA daemons; private CAs need it.
    caCertKey: keyRef.optional(),
    clientCertKey: keyRef,
    clientKeyKey: keyRef,
  })
  .strict();

const sshProfile = z
  .object({
    transport: z.literal("ssh"),
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(22),
    user: z.string().trim().min(1).max(64),
    // SHA-256 host-key pin — hex digest or OpenSSH "SHA256:<base64>".
    hostKeySha256: z.string().trim().min(1).max(128),
    privateKeyKey: keyRef,
    passphraseKey: keyRef.optional(),
  })
  .strict();

const contextProfile = z
  .object({
    transport: z.literal("context"),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((n) => n !== "default", {
        message: 'the in-memory "default" context is not allowed',
      }),
  })
  .strict();

export const dockerTargetProfileSchema = z.discriminatedUnion("transport", [
  socketProfile,
  tcpProfile,
  sshProfile,
  contextProfile,
]);

export type DockerTargetProfile = z.infer<typeof dockerTargetProfileSchema>;

/** Parse + typecheck a resolved profile; throws a non-secret Error. */
export function validateTargetProfile(raw: unknown): DockerTargetProfile {
  const result = dockerTargetProfileSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `target profile invalid: ${issue?.path.join(".") || "profile"} ${issue?.message ?? "malformed"}`,
    );
  }
  return result.data;
}
