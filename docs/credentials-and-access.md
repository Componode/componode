---
title: Credentials & access
description: Roles, sign-in options, sessions, and the encrypted credential store.
---

# Credentials & access

How people sign in, what each role can do, and how integration secrets are
stored.

## People and roles

Every login is a **Person** record (`/users`, admin-managed). Three roles,
enforced by the API — UI hiding is advisory only:

| Role | Can do |
|---|---|
| `VIEWER` | Read the catalog, dashboard, sources, and suggestions. Default for self-registered users. |
| `EDITOR` | Everything a viewer can, plus curate: create/edit products, wire edges, decide suggestions, manage org entities, trigger imports. |
| `ADMIN` | Everything an editor can, plus: users and roles, credentials, Import Agents, audit feed, workspace/auth/session settings, source retire/reactivate. |

## Sign-in

- **Local auth** — username + password (Argon2id hashing, server-side
  sessions). The bootstrap admin comes from `BOOTSTRAP_ADMIN_*` env vars.
- **Self-registration** — off by default; when enabled in authentication
  settings it creates `VIEWER` accounts.
- **OIDC SSO** — optional; configured under **Settings → Authentication**
  (issuer, client ID/secret, role mapping). See
  [Deployment → OIDC](./deployment#oidc-single-sign-on).
- **Sessions** — `/sessions` lists your own sessions; admins manage policy
  under Settings. Password reset tokens are shown once to an admin for
  manual hand-off — there is no email delivery.

## Credential store

Importers authenticate to external systems through **credentials**
(`/credentials`, admin only) — named bundles of secret keys (e.g. a GitHub
token or an Alibaba AccessKey pair).

- **Write-only** — you submit secret values once; afterwards the UI shows
  only masked key hints. The API never returns values.
- **Encrypted at rest** — AES-256-GCM with a master key from
  `COMPONODE_SECRETS_KEY` (or `SECRETS_DIR/master.key`). Without a key the
  store is read-only — see
  [Deployment → Credential store](./deployment#credential-store).
- **Test before you run** — each credential has a Test action that verifies
  it against the target system without starting an import.
- **Rotation** — edit a credential to replace values in place; importer
  configs keep working because they reference the credential, not the
  secrets.

## Two credential kinds

| Kind | Where secrets live | Use when |
|---|---|---|
| `STORED` | Encrypted in the hub database | The hub runs the import and reaches the source itself |
| `AGENT_MANAGED` | On the agent host — the hub stores *reference names* only (`{env: "…"}`, `{file: "…"}`) | An [Import Agent](./import-agents) runs the import; secret material never crosses the wire |

## Rules of thumb

- Use one credential per external account/token, then reuse it across
  importer configs.
- Prefer the narrowest external permission the importer asks for — each
  [importer guide](./importers/) lists the scopes it needs.
- Prefer `*_FILE` env vars and mounted secret files over plain env vars
  anywhere the platform supports it.
