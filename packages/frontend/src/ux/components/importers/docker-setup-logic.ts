/**
 * Pure helpers for the guided Docker importer setup wizard (spec 063).
 * No React, no API calls — everything here is unit-testable in isolation.
 */

export type SetupTransport = "socket" | "tcp" | "ssh" | "context";

export interface RouteFieldDef {
  key: string;
  label: string;
  required?: boolean;
  number?: boolean;
  placeholder?: string;
  hint?: string;
}

export interface TransportDef {
  value: SetupTransport;
  label: string;
  description: string;
  /** Plain-language prerequisites shown before the route fields. */
  guidance?: string;
  fields: RouteFieldDef[];
}

/**
 * Guided-setup transports mirror the manual target form, minus the `*Key`
 * credential-name fields — the wizard derives canonical secret key names
 * itself (TRANSPORT_SECRET_KEYS / SECRET_KEY_REF below).
 */
export const DOCKER_SETUP_TRANSPORTS: TransportDef[] = [
  {
    value: "socket",
    label: "Local socket / named pipe",
    description: "The Hub talks to a Docker Engine on the same host over its socket.",
    guidance:
      "Requires the Hub container to mount the Docker socket — the default Compose stack does not mount it. See docs/deployment.md for the opt-in mount and its security implications (socket access is root-equivalent on the host).",
    fields: [
      {
        key: "path",
        label: "Socket or pipe path",
        required: true,
        placeholder: "/var/run/docker.sock or //./pipe/docker_engine",
        hint: "Absolute path; no .. segments.",
      },
    ],
  },
  {
    value: "tcp",
    label: "TCP (mutual TLS)",
    description: "The Docker Engine API over HTTPS with client-certificate authentication.",
    guidance:
      "Requires a CA certificate (private CAs only), a client certificate, and a client private key. Values are stored encrypted as a Componode credential — never inside the target profile.",
    fields: [
      { key: "host", label: "Host", required: true, placeholder: "engine.example.com" },
      { key: "port", label: "Port", required: true, number: true, placeholder: "2376" },
      { key: "caCertKey", label: "CA certificate", hint: "Optional — only for private CAs." },
      { key: "clientCertKey", label: "Client certificate", required: true },
      { key: "clientKeyKey", label: "Client private key", required: true },
    ],
  },
  {
    value: "ssh",
    label: "SSH (pinned host key)",
    description: "docker system dial-stdio over SSH with a pinned host key.",
    guidance:
      "Requires the engine host's SSH host key fingerprint (SHA-256, e.g. from ssh-keyscan) and a private key. An optional passphrase is supported.",
    fields: [
      { key: "host", label: "Host", required: true, placeholder: "engine.example.com" },
      { key: "port", label: "Port", number: true, placeholder: "22" },
      { key: "user", label: "User", required: true, placeholder: "docker" },
      { key: "hostKeySha256", label: "Host key SHA-256 pin", required: true, placeholder: "SHA256:…" },
      { key: "privateKeyKey", label: "Private key", required: true },
      { key: "passphraseKey", label: "Passphrase", hint: "Optional." },
    ],
  },
  {
    value: "context",
    label: "Named Docker context",
    description: "A named context provisioned inside the Hub's Docker context store.",
    guidance:
      "Only works when the Hub container's Docker context store has been provisioned with the named context (docker context create inside the Hub image). The 'default' context is not allowed.",
    fields: [{ key: "name", label: "Context name", required: true, hint: "Must exist in the Hub's Docker context store." }],
  },
];

/**
 * Canonical secret key names per transport — the wizard stores secret values
 * under these names and derives the profile's `*Key` references from them,
 * so users never type credential key names by hand.
 */
export const TRANSPORT_SECRET_KEYS: Record<SetupTransport, { required: string[]; optional: string[] }> = {
  socket: { required: [], optional: [] },
  context: { required: [], optional: [] },
  tcp: { required: ["clientCert", "clientKey"], optional: ["caCert"] },
  ssh: { required: ["sshPrivateKey"], optional: ["sshPassphrase"] },
};

/** Canonical secret key → profile `*Key` field that references it. */
const SECRET_KEY_REF: Record<string, string> = {
  caCert: "caCertKey",
  clientCert: "clientCertKey",
  clientKey: "clientKeyKey",
  sshPrivateKey: "privateKeyKey",
  sshPassphrase: "passphraseKey",
};

/** All secret keys a transport may use (required + optional). */
export function transportSecretKeys(transport: SetupTransport): string[] {
  const t = TRANSPORT_SECRET_KEYS[transport];
  return [...t.required, ...t.optional];
}

/**
 * Build the non-secret target profile for a transport. Route fields are the
 * transport's non-secret inputs; `providedSecretKeys` lists which canonical
 * secrets the user supplied values for — each becomes a `*Key` reference to
 * the canonical name (optional secrets only when provided).
 */
export function buildTargetProfile(
  transport: SetupTransport,
  routeFields: Record<string, string>,
  providedSecretKeys: string[] = [],
): Record<string, unknown> | null {
  const def = DOCKER_SETUP_TRANSPORTS.find((t) => t.value === transport);
  if (!def) return null;
  const out: Record<string, unknown> = { transport };
  const secretRefFields = new Set(Object.values(SECRET_KEY_REF));
  for (const f of def.fields) {
    // *Key-labelled fields are secret references handled below, not literals.
    if (secretRefFields.has(f.key)) continue;
    const raw = (routeFields[f.key] ?? "").trim();
    if (f.required && !raw) return null;
    if (!raw) continue;
    out[f.key] = f.number ? Number(raw) : raw;
  }
  for (const secretKey of providedSecretKeys) {
    const refField = SECRET_KEY_REF[secretKey];
    if (refField && transportSecretKeys(transport).includes(secretKey)) {
      out[refField] = secretKey;
    }
  }
  return out;
}

/** Route-field keys that carry secret references (excluded from literal copy). */
export function isSecretRefField(transport: SetupTransport, fieldKey: string): boolean {
  const def = DOCKER_SETUP_TRANSPORTS.find((t) => t.value === transport);
  return Boolean(def?.fields.some((f) => f.key === fieldKey && f.key.endsWith("Key")));
}

const SLUG_RE = /[^a-z0-9]+/g;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

/**
 * Suggest an editable target selector from the importer label (falling back
 * to the route host). Target IDs are immutable after creation — the wizard
 * surfaces that note next to the field.
 */
export function suggestTargetId(label: string, host?: string): string {
  const base = slugify(label) || slugify(host ?? "") || "docker-engine";
  return base;
}

/**
 * True when a credential's key hints cover every required canonical secret
 * key for the transport. Only STORED + ACTIVE credentials qualify — callers
 * filter on kind/status before calling this.
 */
export function credentialCoversKeys(
  keyHints: Record<string, string> | undefined,
  requiredKeys: string[],
): boolean {
  if (!keyHints) return false;
  const provided = new Set(Object.keys(keyHints));
  return requiredKeys.every((k) => provided.has(k));
}

export const DOCKER_SETUP_SCHEDULES = [
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 2 * * *", label: "Daily at 02:00" },
  { value: "manual", label: "Manual only" },
] as const;
