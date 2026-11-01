---
title: Quickstart
description: From zero to first imported asset and curated product edge in about 15 minutes.
---

# Quickstart

Get Componode running, log in, and import your first asset — about 15
minutes. All you need is Docker.

::: info Educational project
This runs a local, self-contained stack for exploration. Componode is a
learning project — don't point it at infrastructure you care about.
:::

## 1. Start the stack

```bash
git clone https://github.com/Componode/componode.git
cd componode
cp .env.example .env
```

Open `.env` and set two values:

- `COOKIE_SECRET` — any strong random string (e.g. `openssl rand -base64 32`)
- `BOOTSTRAP_ADMIN_PASSWORD` — the password for your first admin login

```bash
docker compose up -d
docker compose ps   # wait for the app service to become healthy
```

Migrations and the bootstrap admin account run automatically on first boot.

## 2. Log in

Open `https://localhost` (the bundled Caddy serves a self-signed
certificate — accept the browser warning) or `http://localhost:3000`, and
sign in with the bootstrap admin credentials from `.env`.

You land on the **dashboard** — empty for now, because nothing has been
imported yet.

## 3. Run your first import

The fastest first import needs **no credentials**: the Web URL importer
probes a public web endpoint and records it as a component.

1. Go to **Sources → Importers → New**.
2. Pick **Web URL**, give the config a name, and enter a public URL —
   for example `https://example.com`.
3. Save, then click **Run** on the config.
4. Open the run to watch its phases complete, then check
   **Catalog → Components** — you'll find a new component with a
   `PRODUCTION` instance holding the probe result.

That's the factual layer working: an importer read an external source and
the core upserted what it found.

## 4. Curate the meaning layer

Importers only tell you what exists. Products are what you make of it:

1. Go to **Products → New** and create a Digital Product — pick a type
   (`BUSINESS_CAPABILITY`, `PLATFORM`, or `CUSTOMER_FACING`) and an owner.
2. On the product page, wire a `DEPENDS_ON` edge to the component you just
   imported.
3. Revisit the **dashboard** — coverage and health now reflect your wiring.

## Where next

| Want to… | Go to |
|---|---|
| Understand the model you just used | [Digital Products in depth](./digital-products) |
| Import real inventory (GitHub, cloud, Docker) | [Importers](./importers/) — start with [GitHub](./importers/github) |
| Learn what each screen does | [Using the catalog](./using-the-catalog) |
| Create users or connect SSO | [Credentials & access](./credentials-and-access) |
| Tune the deployment (TLS, OIDC, external DB) | [Deployment](./deployment) |
