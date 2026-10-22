# Architecture Overview

This document describes the runtime architecture of Componode: the deployment
topology, the end-to-end data flow, authentication, the importer pipeline, and
the persistence model. It reflects the code as shipped; the *why* behind each
decision lives in `researches/architecture-decisions.md` (ADR index) and the
binding principles in `.specify/memory/constitution.md`.

## System context

Componode is a single-organization, self-hosted monolith. One Docker Compose
deployment = one organization. The backend serves the built frontend as static
assets, so the whole application is one container plus PostgreSQL.

```mermaid
flowchart LR
    subgraph Users["Users"]
        Browser["Browser<br/>React SPA"]
        Prom["Prometheus<br/>scraper"]
        IdP["OIDC Identity Provider<br/>(optional SSO)"]
    end

    subgraph Host["Docker host"]
        subgraph Compose["docker-compose.yml"]
            subgraph AppC["app container (node:24-alpine, non-root uid 10001)"]
                FE["Frontend static assets<br/>(React 18 + Vite build)"]
                API["Fastify backend<br/>API under /api/v1<br/>GET /metrics"]
            end
            subgraph PgC["postgres container (postgres:16-alpine)"]
                DB[("PostgreSQL<br/>componode db<br/>pgcrypto")]
                VOL["postgres_data<br/>volume"]
            end
            Caddy["caddy service<br/>(optional, TLS termination)"]
        end
    end

    subgraph Sources["External sources"]
        GH["GitHub"]
        AWS["AWS"]
        AZ["Azure"]
        K8s["Kubernetes"]
        Web["Web / API / MCP endpoints"]
    end

    subgraph Remote["Remote network (private VPC / on-prem / egress-only)"]
        Agent["Import Agent container<br/>(Dockerfile.agent)<br/>ops listener :9464"]
        RSrc["Sources unreachable<br/>from the hub"]
    end

    Browser -->|"HTTPS via proxy, or HTTP :3000"| Caddy
    Caddy -->|"reverse_proxy app:3000"| API
    Browser -->|"http://localhost:3000"| API
    API --> FE
    API -->|"pg pool, Kysely<br/>DATABASE_URL"| DB
    DB --- VOL
    API -->|"pull-only AsyncGenerator"| Sources
    API -.->|"OIDC authorization code + PKCE"| IdP
    Prom -->|"GET /metrics"| API
    Agent -->|"outbound WSS (TLS), protocol v2 —<br/>the hub never dials in"| API
    API -.->|"job.assign / cancel frames<br/>over the agent's stream"| Agent
    Agent -->|"pull-only AsyncGenerator"| RSrc
    Prom -.->|"GET /metrics (if reachable)"| Agent
```

Key infrastructure facts:

- The `app` image is a single-stage `node:24-alpine` build that runs
  `packages/backend/dist/server.js` as a non-root user and exposes port `3000`.
- PostgreSQL 16 is bundled (`postgres_data` volume); **PostgreSQL 14+** is the
  floor for external databases, and `pgcrypto` is required — both verified at
  startup before migrations run.
- `init-db.sql` creates the `componode` database and a least-privilege role on
  first boot of the bundled Postgres.
- The app **does not terminate TLS** (ADR-093). The bundled `caddy` service
  fronts it with a self-signed certificate from Caddy's internal CA
  (`tls internal`, `SITE_ADDRESS` in `.env`); `TRUSTED_PROXY_IP` defaults to
  `1` hop so `X-Forwarded-*` headers are honored, and `PUBLIC_URL` makes
  OIDC callbacks resolve to the external origin.
- `GET /api/v1/health` (liveness/readiness) and `GET /metrics` (Prometheus)
  are the only unauthenticated endpoints besides the public auth routes.
- `Dockerfile.agent` builds a second image from the same monorepo running
  `packages/agent/dist/main.js` — an Import Agent for networks the hub
  cannot reach (ADR-116). It enrolls once, persists its durable credential
  on the `/state` volume, and holds a single outbound TLS WebSocket to the
  hub. Its process-local ops listener serves `/healthz`, `/readyz`, and
  `/metrics` (GET-only, unauthenticated) on `AGENT_OPS_HOST:AGENT_OPS_PORT`
  (default `0.0.0.0:9464`); the image `HEALTHCHECK` hits `/healthz`.

## Request data flow

Every API request traverses the same plugin pipeline before reaching a route.

```mermaid
flowchart TD
    B["Browser SPA<br/>(TanStack Query hooks)"]
    B -->|"cookie: componode_session<br/>header: x-csrf-token"| F

    subgraph F["Fastify app (packages/backend)"]
        direction TB
        P1["helmet → security headers"]
        P2["CORS (off unless CORS_ALLOWED_ORIGINS)"]
        P3["rate-limit (global + stricter auth limits)"]
        P4["session plugin → loads session by token hash<br/>enforces idle + absolute timeouts"]
        P5["CSRF → double-submit check on mutations"]
        P6["RBAC requireRole → x-permission per route"]
        R["routes/* → Zod validation at boundary"]
        S["services/* → domain logic"]
        K["Kysely → parameterized SQL only<br/>(no sql.raw / sql.fragment)"]
        EH["error handler → RFC 7807 problem+json"]
        OBS["pino logs · prom-client metrics · OTel tracing"]

        P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> R --> S --> K
        R -.->|"thrown errors"| EH
        S -.->|"logs / metrics / spans"| OBS
    end

    K --> PG[("PostgreSQL<br/>28 tables")]
    S --> AUD["append-only audit<br/>entity_changes / edge_changes"]
    AUD --> PG
```

Conventions enforced on this path:

- All routes are under `/api/v1` except `GET /metrics` (ADR-070).
- `GET`/`HEAD` are side-effect-free on domain state (ADR-094).
- Inputs are validated with Zod at the route boundary; unknown fields are
  rejected (ADR-095).
- Errors are RFC 7807 documents (`application/problem+json`) carrying the
  controlled `code`/`message`/`details` fields; internals never leak
  (ADR-071, ADR-096).
- Default list queries exclude `RETIRED` records and `GONE` instances unless
  `includeRetired`/`includeGone` is passed.

## Authentication and authorization

```mermaid
flowchart TD
    subgraph Local["Local auth"]
        L1["POST /api/v1/auth/login<br/>rate-limited 5/min"]
        L2["argon2id verify<br/>(@node-rs/argon2)"]
        L3["create session:<br/>random token → SHA-256 hash stored<br/>sessions.id = hash, token never stored"]
    end

    subgraph OIDC["OIDC auth (optional)"]
        O1["POST /api/v1/auth/oidc/login<br/>issuer discovery, PKCE"]
        O2["GET /api/v1/auth/oidc/callback<br/>code exchange, JIT user provisioning,<br/>roleMapping → ADMIN/EDITOR/VIEWER"]
    end

    L1 --> L2 --> L3
    O1 --> O2 --> L3
    L3 --> C["Set-Cookie: componode_session (HttpOnly)<br/>+ componode_csrf token"]

    C --> REQ["Subsequent requests"]
    REQ --> SV["session plugin:<br/>hash(cookie) → lookup → expiry, idle,<br/>revocation checks"]
    SV --> ROLE["requireRole:<br/>ADMIN > EDITOR > VIEWER"]
    SV --> CSRF["mutations:<br/>x-csrf-token == componode_csrf"]
    ROLE -.->|"ADMIN-gated routes"| Admin

    subgraph Admin["Administration"]
        USERS["/users CRUD + role assignment"]
        SESS["/sessions list + revoke<br/>(own sessions; ADMIN any)"]
        OIDCCFG["/settings/oidc<br/>issuer, client id, secret → credential store"]
    end
```

- Session tokens are cryptographically random (not UUIDs — ADR-099), stored
  only as SHA-256 hashes; `tokenLast4` is kept for display matching. The API
  exposes a non-secret `publicId` for revocation.
- Self-registration exists but is off unless `allow_self_registration` is
  enabled in settings; it creates a `VIEWER` and auto-logs in.
- Password reset uses single-use, expiring tokens generated by an
  ADMIN-permitted endpoint.

## Importer pipeline

Importers are the factual layer. They are pull-only `AsyncGenerator`s that
never touch the database; the backend owns upsert, dedup, reconciliation, and
run history.

```mermaid
flowchart TD
    subgraph Trigger["Run triggers"]
        Cron["node-cron scheduler<br/>(per-config cron schedule)"]
        Manual["POST /importer-configs/:id/trigger<br/>→ 202 { runId }"]
    end

    Cron --> RS["import-run-service<br/>creates run row (PENDING→RUNNING)<br/>IMPORTER_MAX_CONCURRENCY=3 via p-queue"]
    Manual --> RS

    RS --> REG["importer-registry<br/>dynamic import of manifest + impl"]
    REG --> SEC["secret resolution:<br/>credentialIds → credentials table<br/>(AES-256-GCM decrypt in memory)<br/>+ legacy env/file secretRefs"]
    SEC --> IMP["Importer.run(config, secrets, ctx)<br/>AsyncGenerator<DiscoveredAsset>"]

    subgraph Importers["In-tree importer packages (depend only on @componode/core)"]
        I1["github"]
        I2["aws"]
        I3["azure"]
        I4["kubernetes"]
        I5["web-url"]
        I6["api-url"]
        I7["mcp-server"]
        I8["alibaba-cloud"]
    end
    IMP --> Importers --> EXT["External APIs<br/>(SSRF guard urlSafetyError on URL importers)"]

    Importers -->|"yield DiscoveredAsset"| VAL["validateDiscoveredAsset<br/>(category + provider + resourceType,<br/>stable externalId)"]
    VAL --> UPS["Upsert by externalId:<br/>components + component_instances"]
    UPS --> REC["Reconciliation:<br/>unseen instances → GONE<br/>unseen components → RETIRED"]
    REC --> HIST["import_runs / import_run_errors<br/>consequential changes → audit"]

    UPS --> PG[("PostgreSQL")]
    REC --> PG
    HIST --> PG
    SEC --> PG
```

- Run statuses: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`,
  `INTERRUPTED`. Duplicate triggers return `409 RUN_IN_PROGRESS`.
- Cancellation is cooperative via `AbortSignal` (`context.signal.aborted`).
- Optional `testSecrets` probes let users verify stored credentials without a
  full run.
- Configs can also run **remotely**: when bound to an Import Agent the hub
  dispatches the job over the agent's stream, and the streamed assets flow
  through the same validate → upsert → reconcile path — see *Import Agents*
  below.
- `DiscoveredAsset.relationships` is **not** part of the v1 contract —
  importer-declared product edges are a v2 feature.

## Import Agents (remote execution)

Import Agents (ADR-116, specs 025–028) run the same in-tree importer
packages on hosts the hub cannot reach — private VPCs, on-prem Kubernetes,
egress-only networks. Connectivity is strictly outbound: the agent opens one
TLS WebSocket to `/api/v1/agent/stream`; the hub never dials in.

```mermaid
flowchart LR
    subgraph Hub["Hub (packages/backend)"]
        direction TB
        AS["agent-service<br/>registry, enrollment tokens,<br/>policy (allowedImporters)"]
        SS["agent-session-service<br/>WSS stream, heartbeats,<br/>agent_sessions rows"]
        RR["remote-run-service<br/>job.assign / ack / cancel →<br/>asset.batch / run.complete"]
    end

    subgraph AgentHost["Agent host (packages/agent)"]
        direction TB
        CL["client: enroll once → durable<br/>credential on /state; hello →<br/>heartbeat; reconnect backoff"]
        EX["executor: runs the importer<br/>locally, streams frames"]
        OPS["ops listener :9464<br/>GET /healthz /readyz /metrics"]
    end

    CL -->|"outbound WSS (TLS), protocol v2 —<br/>frames flow both ways"| SS
    AS --> SS
    RR -->|"job.assign / cancel"| SS
    SS -->|"job.ack / asset.batch /<br/>run.complete"| RR
    EX --> AGI["importer-* packages<br/>(lockstep manifest set)"]
    SS --> AGTBL[("import_agents /<br/>agent_sessions")]
```

- **Enrollment**: a single-use, ~24 h enrollment token is exchanged once for
  a durable credential the agent persists in `AGENT_STATE_DIR`; rotate and
  revoke are hub-side operations that drop live sessions.
- **Lockstep handshake**: `hello` must report the hub's exact importer set
  and `AGENT_PROTOCOL_VERSION` (currently `2`); a mismatch closes the stream
  and the agent image must be rebuilt from the same commit as the hub.
- **Remote runs**: a config bound to an agent dispatches `job.assign` over
  the stream (`MAX_JOBS` caps concurrency; overflow queues hub-side). Agent
  NACKs, session loss, and cancellation map to `AGENT_INCOMPATIBLE`,
  `SECRET_RESOLUTION_FAILED`, `AGENT_LOST` (remote runs are never resumed),
  or `run.complete{CANCELLED}`.
- **Agent-managed credentials** (spec 026): `AGENT_MANAGED` credentials
  store reference names only (`{env}` / `{file}`); the agent resolves them
  on its host — secret material never crosses the stream in either
  direction.
- **Ops observability** (spec 028): heartbeats carry an `ops` counter
  snapshot persisted replace-on-write to `import_agents."reportedStatus"`
  and exposed on `GET /agents`/`GET /agents/{id}` alongside
  `lastHeartbeatAt`/`lastDisconnectReason`; the agent-local listener
  mirrors the hub `/metrics` posture (unauthenticated, GET-only, no secret
  material). Full reference: `docs/agents.md`, `docs/agent-protocol.md`.

## Credential store

```mermaid
flowchart LR
    UI["Admin UI<br/>/credentials"]
    UI -->|"write-only API<br/>secrets never returned"| CS["credential-service"]
    CS --> ENC["AES-256-GCM encrypt<br/>keyVersion tagged"]
    ENC --> TBL[("credentials table")]

    subgraph KeySrc["Master key resolution (boot order)"]
        K1["1. COMPONODE_SECRETS_KEY env"]
        K2["2. SECRETS_DIR/master.key<br/>(auto-generated only if dir exists)"]
        K3["3. none → degraded mode<br/>(503 CREDENTIAL_KEY_UNAVAILABLE)"]
        K1 --> K2 --> K3
    end
    KeySrc --> ENC
    K4["COMPONODE_SECRETS_KEY_PREVIOUS<br/>dual-key rotation at boot"] -.-> ENC
```

The OIDC client secret from **Settings → OIDC** also lives here. The database
plus the master key together form the backup unit.

## Persistence model

PostgreSQL holds 28 tables (migrations `001`–`019`). Entity IDs are UUID v7
generated application-side; enum-like fields use `CHECK` constraints driven by
`packages/core` constants rather than native ENUMs.

```mermaid
erDiagram
    line_of_businesses ||--o{ digital_products : owns
    teams ||--o{ digital_products : "team owns"
    teams ||--o{ persons : "has members"
    persons ||--o{ sessions : "holds"
    persons ||--o{ password_reset_tokens : "requests"

    digital_products ||--o{ product_composes : "parent of (DAG)"
    digital_products ||--o{ product_composes : "child of"
    digital_products ||--o{ product_consumes_from : "consumes PLATFORM"
    digital_products ||--o{ product_depends_on_component : "depends on"
    components ||--o{ product_depends_on_component : "depended on by"
    digital_products ||--o{ product_depends_on_component_group : "depends on"
    component_groups ||--o{ product_depends_on_component_group : "depended on by"

    component_groups ||--o{ components : "groups"
    teams ||--o{ components : "team owns"
    teams ||--o{ component_groups : "team owns"
    components ||--o{ component_instances : "deployed as"

    digital_products ||--o{ edge_suggestions : "candidate for"
    components ||--o{ edge_suggestions : "suggested for"

    importer_configs ||--o{ import_runs : "produces"
    import_runs ||--o{ import_run_errors : "records"
    importer_configs ||--o{ importer_config_credentials : "references"
    credentials ||--o{ importer_config_credentials : "referenced by"

    import_agents ||--o{ agent_sessions : "connection episodes"
    importer_configs }o--o| import_agents : "optionally bound to"
    import_runs }o--o| import_agents : "executed by (nullable)"
```

Edge rules enforced in the service layer:

- `COMPOSES` is a DAG — cycle attempts return `409 CYCLE_DETECTED`; any
  product type may be a parent (ADR-109).
- `CONSUMES_FROM` targets must be `PLATFORM`.
- `DEPENDS_ON` targets a concrete component or a `ComponentGroup` (expanded
  to members at read time, ADR-110); `componentIds[]` bulk form allowed.
- `edge_suggestions` stages server-generated `DEPENDS_ON` candidates —
  human-decided via accept/dismiss, never auto-wired (ADR-113).
- Audit tables (`entity_changes`, `edge_changes`) are append-only via
  database triggers (migration `002`); terminal run states are locked by
  triggers as well (migration `003`). They reference audited rows by
  polymorphic `entityType`/`entityId` rather than foreign keys.
- Not shown: `app_settings` and `oidc_config` singleton config tables, and
  the component-to-component relationship tables (`component_exposes`,
  `component_sources_from`, `component_depends_on_component`).

## Monorepo package boundaries

```mermaid
flowchart TD
    subgraph Mono["pnpm workspaces + Turborepo"]
        CORE["@componode/core<br/>contracts, constants, Zod schemas,<br/>validateDiscoveredAsset, observability<br/>(zero @componode deps — leaf)"]

        BE["@componode/backend<br/>Fastify API + Kysely services<br/>(imports importer manifests only)"]

        FE["@componode/frontend<br/>React SPA<br/>(types from core; backend over HTTP)"]

        AG["@componode/agent<br/>Import Agent runtime<br/>(imports importer manifests only)"]

        subgraph IMPS["importer-* (8 packages)"]
            direction LR
            IG["github"] --- IA["aws"] --- IZ["azure"] --- IK["kubernetes"] --- IW["web-url"] --- IP["api-url"] --- IM["mcp-server"] --- IB["alibaba-cloud"]
        end
    end

    BE --> CORE
    FE --> CORE
    AG --> CORE
    IMPS --> CORE
    BE -.->|"manifest + implPath dynamic import"| IMPS
    AG -.->|"same registry — lockstep manifest set"| IMPS
```

Hard boundaries (ADR-065): importers never import `@componode/backend` or each
other; `core` never imports anything `@componode/*`.

## Where to go next

| Topic | Document |
|---|---|
| Binding principles | `.specify/memory/constitution.md` |
| Decision rationale | `researches/architecture-decisions.md`, `researches/adrs/` |
| API surface | `docs/api.md`, `docs/openapi.yaml` |
| Deployment & ops | `docs/deployment.md` |
| Import Agents | `docs/agents.md`, `docs/agent-protocol.md` |
| Building an importer | `docs/importer-development.md` |
| UI conventions | `docs/ux.md` |
| Security posture | `docs/security/` (dated assessments) |
