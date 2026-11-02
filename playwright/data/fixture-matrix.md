# Synthetic Fixture and Table Matrix

This matrix covers all 35 application-owned persistent tables. The two migration bookkeeping tables are excluded. Use the database only for deterministic bulk baseline data where direct seeding preserves constraints; use application flows for encrypted values and lifecycle-generated history.

| Table | Fixture/lifecycle source | Coverage |
| --- | --- | --- |
| `digital_products` | UI/API baseline and journey actions | Create, edit, ownership, retire/delete where permitted, relationships |
| `components` | Bulk deterministic rows plus real importer output | 201+ rows for page boundaries; edit and retire; no invented hard delete |
| `component_instances` | Bulk environment rows plus first-instance recovery and probe flows | Environments, status, add/change; no general instance delete unless product UI supports it |
| `component_groups` | UI/API | Create, edit, delete where allowed |
| `line_of_businesses` | Admin UI/API | Create, edit, delete where allowed |
| `teams` | Admin UI/API | Create, edit, delete where allowed |
| `product_composes` | Product hierarchy UI/API | Add/remove edges, DAG and cycle rejection |
| `product_consumes_from` | Product hierarchy UI/API | Platform target rule and edge lifecycle |
| `product_depends_on_component` | Product UI/API | Add/remove relationship and derived product behavior |
| `product_depends_on_component_group` | Product UI/API | Group dependency behavior |
| `component_depends_on_component` | Supported component relationship flow | Add/remove and referenced Component visibility |
| `component_sources_from` | Importer reconciliation | Source membership lifecycle |
| `component_exposes` | Supported component relationship flow/importer mapping | Create/update/remove supported relationship |
| `persons` | Bootstrap Admin; create Editor/Viewer through Admin flow; Dex JIT user | Role-specific auth and user management |
| `sessions` | Real logins and session actions | Session listing, logout, self/other revoke policy |
| `password_reset_tokens` | Admin-generated reset flow | Generate, confirm, consume; never seed token values directly |
| `oidc_config` | Admin settings UI connected to Dex | Save, update, invalid discovery/callback behavior |
| `importer_configs` | Importer UI/API | Create, edit, trigger, cancel, delete |
| `importer_config_credentials` | Supported importer config secret flow | Credential/config linkage and redaction |
| `credentials` | Admin UI/API with synthetic values | Create, update, test, delete; encrypted/write-only assertions |
| `import_agents` | Admin UI and real enrollment | Create, connect, inspect, revoke; online/offline |
| `agent_sessions` | Real Import Agent WSS runtime | Connected/disconnected state and session history |
| `import_runs` | Real importer runs against mocks | Success, empty, changed, cancelled, failed |
| `import_run_errors` | Controlled importer/mock error | Error type, safe message, no secret leakage |
| `importer_sources` | Importer first-run identity reporting | Stable source identity and lifecycle |
| `source_component_memberships` | Importer reconciliation | Add/update/omit and shared-Source preservation |
| `source_instance_memberships` | Importer reconciliation | Instance membership and omission behavior |
| `docker_targets` | Admin target UI/API with fake mTLS credentials | Create, test, enable/disable, update/delete |
| `entity_changes` | Normal application mutations | Generated history; never fabricate direct rows for ordinary test setup |
| `edge_changes` | Product/component relationship mutations | Generated history and detail reads |
| `edge_suggestions` | Suggestion generation and decisions | Pending/accepted/dismissed/superseded paths and offset/limit |
| `component_monitoring_setups` | URL Check setup UI/API | Hub/Agent, cadence, preserve/reconfigure role boundary |
| `url_checks` | Composite create and regular editor | CRUD, enable/disable, four auth modes, target/window |
| `url_check_observations` | Real Hub/Agent probes | Success, status failure, timeout/error, missed, observation reads |
| `app_settings` | Admin settings flows | Registration switch, default role, session/security settings |
| `kysely_migration` | Migration runner only | Excluded from user fixture coverage |
| `kysely_migration_lock` | Migration runner only | Excluded from user fixture coverage |

## Seed order and rules

1. Run the application migrations against a fresh test database.
2. Bootstrap the Admin from per-run environment values.
3. Create Lines of Business, Teams, and test people through supported flows.
4. Create ordinary deterministic products/components/groups and their valid links/edges. Use direct bulk inserts only for high-volume fixtures and preserve foreign keys, CHECK constraints, UUID v7 IDs, and unique slugs.
5. Create Credentials and Docker targets through APIs/UI; never insert encrypted payloads by hand.
6. Create importer configs, run mock imports, and let the core create Sources, memberships, Components/Instances, runs, and errors.
7. Configure Dex through the Admin UI; login/register/reset to create Persons, Sessions, and password-reset lifecycle rows.
8. Create an Import Agent, capture its one-use enrollment token into ignored `.env-private/`, start the real Agent, and let the WSS handshake create AgentSession history.
9. Create monitoring setup/checks and run Hub/Agent probes to create observations.
10. Exercise user changes and removals through the UI; verify audit and edge history as generated output.

Never fill append-only, encrypted, session, run, Source, AgentSession, or observation tables with hand-authored rows if a supported lifecycle can produce them.

## Pagination volumes

- Components: at least 201 rows to cover the frontend's pageSize 100 auto-fetch across two full pages plus a tail; explicitly check API page boundaries at pageSize 50 and maximum pageSize 100.
- Activity: at least 101 rows for two complete default 50-row pages and a final partial page.
- Suggestions: at least 101 rows for the same limit/offset boundary. Ensure the dataset contains both pending and decided items while preserving unique decision constraints.
